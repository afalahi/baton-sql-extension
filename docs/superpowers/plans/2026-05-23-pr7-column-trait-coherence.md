# PR7: Column-Trait Coherence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect dangling column references inside `resource_types.<rt>.list.map.traits.*` — values that reference a column the corresponding `list.query` never SELECTs. Also flag duplicate `static_entitlements[].id` within a single resource type.

**Architecture:** Two new document-scope rules, supported by two pure utility helpers. (1) `extractColumnRefs(expr)` lives in a new `src/utils/celUtils.ts`; it extracts `.<identifier>` references from connector expressions (jq-style leading-dot accessors) using a single regex with lookbehind to avoid catching `.field` chains. (2) `extractSelectColumns(ast)` is added to `src/utils/sqlUtils.ts`; it walks the `node-sql-parser` AST's SELECT list to return the set of column names + aliases available to row-level expressions, plus a `hasWildcard` flag that signals "can't verify" (rules skip when `SELECT *` is in play). (3) `traitColumnReferenceRule` walks every `rt.list.map.traits.<role>.<field>` and flags column references absent from the SELECT list. (4) `staticEntitlementIdUniquenessRule` walks every `rt.staticEntitlements` and flags duplicate IDs within a single resource type.

**Tech Stack:** TypeScript 4.x strict, `node:test` via `tsx`. Document-scope rule infrastructure established by PR1; latest exemplars in PR4-PR6. The `node-sql-parser` AST is already attached to each `ParsedQuery` (`ast` field), populated by `buildBatonDocument` with dialect awareness from PR2.

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md` rollout row "PR7 — Column-trait coherence":
> Ships a minimal CEL-reference extractor (`extractColumnRefs(expr: string): string[]`) covering the patterns observed in real configs: `.col`, `.col1 + ... + .col2`, `slugify(.col)`. Uses it to verify `map.traits.<role>.<field>` references columns present in the corresponding `list.query` SELECT. Also: `static_entitlements[].id` uniqueness within resource type. ~300-400 LOC. New error categories.

**Design decisions:**

| Edge case | Behavior |
|---|---|
| `list.query` parse failed (`ast === null`) | Skip the resource type entirely (no AST → can't verify). |
| `SELECT * FROM ...` | Skip (`hasWildcard` short-circuits the rule). |
| `extractSelectColumns` returns empty set (unknown SELECT shape) | Skip (avoid false positives). |
| Trait value is not a string (e.g., array `emails:`, object `profile:`) | Recurse into nested fields; check each leaf string. |
| Trait value is a string with no `.<col>` references | No diagnostic (could be a literal status string). |
| Nested column access like `.profile.first_name` | Only the top-level `profile` is extracted (the chain is field-access on the column). |
| Function calls like `slugify(.col)` | Inner `.col` is extracted. |

**Behavior delta:** YES. Configs that reference a non-selected column inside a trait, or duplicate a static entitlement ID, now produce diagnostics.

---

## File Structure

**New files:**
- `src/utils/celUtils.ts` — `extractColumnRefs(expr: string): string[]`
- `src/utils/celUtils.test.ts` — tests for the extractor
- `src/utils/sqlUtils.test.ts` — tests for the new `extractSelectColumns` (does not exist yet; this PR creates it)
- `src/validation/rules/traitColumnReferenceRule.ts`
- `src/validation/rules/traitColumnReferenceRule.test.ts`
- `src/validation/rules/staticEntitlementIdUniquenessRule.ts`
- `src/validation/rules/staticEntitlementIdUniquenessRule.test.ts`

**Modified files:**
- `src/utils/sqlUtils.ts` — append `extractSelectColumns` function
- `src/validation/rules/index.ts` — export + import + array entry for each of the 2 new rules
- `src/validation/pipeline.test.ts` — append smoke tests
- `CHANGELOG.md`
- `package.json` (version 1.9.0 → 1.10.0)

**Not touched:**
- Any of the 21 existing rule files
- `document.ts`, `parsedQuery.ts`, `pipeline.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`
- `src/server/`, `schemas/`, `snippets/`

**Tests after PR7:** 196 → 221 (Task 0: +6 celUtils, Task 1: +6 sqlUtils, Task 2: +7 trait rule (6 unit + 1 pipeline), Task 3: +6 uniqueness rule (5 unit + 1 pipeline)).

---

## Task 0: `extractColumnRefs` (CEL reference extractor)

**Files:**
- Create: `src/utils/celUtils.ts`
- Create: `src/utils/celUtils.test.ts`

Extracts leading-dot column references from connector expressions. Uses a lookbehind to ensure we only catch `.col` at the top level (not the second half of `.a.b` chains).

- [ ] **Step 1: Write the failing tests** in `src/utils/celUtils.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractColumnRefs } from './celUtils';

test('extractColumnRefs: empty string returns []', () => {
  assert.deepEqual(extractColumnRefs(''), []);
});

test('extractColumnRefs: simple leading-dot reference', () => {
  assert.deepEqual(extractColumnRefs('.login'), ['login']);
});

test('extractColumnRefs: concatenation of multiple refs', () => {
  assert.deepEqual(extractColumnRefs('.first_name + " " + .last_name'), ['first_name', 'last_name']);
});

test('extractColumnRefs: function wrapper', () => {
  assert.deepEqual(extractColumnRefs('slugify(.login)'), ['login']);
  assert.deepEqual(extractColumnRefs('lower(.email)'), ['email']);
});

test('extractColumnRefs: chained access extracts only top-level column', () => {
  assert.deepEqual(extractColumnRefs('.profile.first_name'), ['profile']);
});

test('extractColumnRefs: complex expressions', () => {
  // CEL conditional with multiple top-level refs
  const refs = extractColumnRefs('if .active then .login else "disabled"');
  assert.deepEqual(refs.sort(), ['active', 'login']);
});
```

- [ ] **Step 2: Run, verify failures**

```bash
node --import tsx --test src/utils/celUtils.test.ts 2>&1 | tail -10
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/utils/celUtils.ts`**

```ts
/**
 * CEL/jq expression utilities for Baton SQL configs.
 *
 * Trait and map expressions in baton-sql configs use a jq-flavored CEL-like
 * syntax where `.column_name` references a row-level column. This module
 * provides a minimal extractor for those references.
 */

// Match `.identifier` where the dot is NOT preceded by an identifier character.
// This catches top-level refs like `.col` but not the second half of chains like
// `.profile.first_name` (where the second dot is preceded by 'e').
const COLUMN_REF_RE = /(?<![a-zA-Z0-9_])\.([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Extract top-level column references from a connector expression.
 *
 * Returns an array of unique column names referenced via `.col` syntax.
 * Order matches first-occurrence order in the input. Nested access like
 * `.profile.first_name` returns only `['profile']` — the chain `first_name`
 * is field-access on the column, not a separate column.
 *
 * @example
 *   extractColumnRefs('.login')                                  // ['login']
 *   extractColumnRefs('.first_name + " " + .last_name')          // ['first_name', 'last_name']
 *   extractColumnRefs('slugify(.email)')                         // ['email']
 *   extractColumnRefs('.profile.first_name')                     // ['profile']
 */
export function extractColumnRefs(expr: string): string[] {
  if (typeof expr !== 'string' || expr.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of expr.matchAll(COLUMN_REF_RE)) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
```

- [ ] **Step 4: Re-run, verify all 6 tests pass**

```bash
node --import tsx --test src/utils/celUtils.test.ts 2>&1 | tail -10
```

Expected: `pass 6`, `fail 0`.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 202` (196 baseline + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/utils/celUtils.ts src/utils/celUtils.test.ts
git commit -m "utils: add extractColumnRefs (CEL reference extractor)

Minimal extractor for the jq-flavored .col syntax used in Baton SQL trait
and map expressions. Lookbehind regex catches top-level refs while leaving
chained accesses (.profile.first_name) intact — only 'profile' is returned.

Foundation for PR7's traitColumnReferenceRule."
```

---

## Task 1: `extractSelectColumns` (AST SELECT column extractor)

**Files:**
- Modify: `src/utils/sqlUtils.ts` — append the new function
- Create: `src/utils/sqlUtils.test.ts` — new test file (does not exist yet)

Walks the `node-sql-parser` AST's SELECT list and returns the set of column names + aliases available to row-level expressions. Returns `hasWildcard: true` when `SELECT *` is present so the rule can short-circuit.

- [ ] **Step 1: Write the failing tests** in `src/utils/sqlUtils.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getParser, extractSelectColumns } from './sqlUtils';

function parse(sql: string): any {
  return getParser().astify(sql);
}

test('extractSelectColumns: null AST returns empty + no wildcard', () => {
  const result = extractSelectColumns(null);
  assert.equal(result.columns.size, 0);
  assert.equal(result.hasWildcard, false);
});

test('extractSelectColumns: plain SELECT lists column names', () => {
  const result = extractSelectColumns(parse('SELECT login, email FROM users'));
  assert.deepEqual([...result.columns].sort(), ['email', 'login']);
  assert.equal(result.hasWildcard, false);
});

test('extractSelectColumns: SELECT * sets hasWildcard', () => {
  const result = extractSelectColumns(parse('SELECT * FROM users'));
  assert.equal(result.hasWildcard, true);
});

test('extractSelectColumns: alias takes precedence over column name', () => {
  const result = extractSelectColumns(parse('SELECT login AS l, email FROM users'));
  assert.deepEqual([...result.columns].sort(), ['email', 'l']);
});

test('extractSelectColumns: qualified column uses base name', () => {
  const result = extractSelectColumns(parse('SELECT u.login, u.email AS e FROM users u'));
  assert.deepEqual([...result.columns].sort(), ['e', 'login']);
});

test('extractSelectColumns: function call with alias uses alias', () => {
  const result = extractSelectColumns(parse('SELECT COUNT(*) AS total FROM users'));
  assert.deepEqual([...result.columns], ['total']);
  assert.equal(result.hasWildcard, false);
});
```

- [ ] **Step 2: Run, verify failures**

```bash
node --import tsx --test src/utils/sqlUtils.test.ts 2>&1 | tail -10
```

Expected: import error (`extractSelectColumns` not exported).

- [ ] **Step 3: Append `extractSelectColumns` to `src/utils/sqlUtils.ts`**

```ts
/**
 * Extract the set of column names + aliases available to row-level expressions
 * after a SELECT statement. For `SELECT col, t.col2 AS alias`, returns
 * {col, alias}. `SELECT *` sets `hasWildcard: true` and the caller should
 * treat that as "can't verify" rather than "no columns".
 *
 * Handles AST shapes from node-sql-parser. Non-select statements return an
 * empty set with hasWildcard: false.
 */
export function extractSelectColumns(ast: any): { columns: Set<string>; hasWildcard: boolean } {
  const columns = new Set<string>();
  let hasWildcard = false;

  if (!ast) return { columns, hasWildcard };

  const statements = Array.isArray(ast) ? ast : [ast];

  for (const stmt of statements) {
    if (!stmt || stmt.type !== 'select') continue;
    if (!Array.isArray(stmt.columns)) {
      // node-sql-parser sometimes uses the literal string '*' as the columns field for SELECT *
      if (stmt.columns === '*') hasWildcard = true;
      continue;
    }

    for (const col of stmt.columns) {
      if (col === '*') {
        hasWildcard = true;
        continue;
      }
      if (!col || typeof col !== 'object') continue;

      const expr = col.expr;

      // node-sql-parser emits SELECT * as { expr: { type: 'column_ref', column: '*' } }.
      // Some older shapes use { expr: { type: 'star' } }; accept either.
      if (expr?.type === 'star') {
        hasWildcard = true;
        continue;
      }
      if (expr?.type === 'column_ref' && expr.column === '*') {
        hasWildcard = true;
        continue;
      }

      if (typeof col.as === 'string' && col.as.length > 0) {
        columns.add(col.as);
        continue;
      }

      if (expr?.type === 'column_ref' && typeof expr.column === 'string') {
        columns.add(expr.column);
        continue;
      }

      // Other shapes (functions, computed exprs) without alias are not addressable
      // by name — skip them rather than guess.
    }
  }

  return { columns, hasWildcard };
}
```

- [ ] **Step 4: Re-run unit tests, verify all 6 pass**

```bash
node --import tsx --test src/utils/sqlUtils.test.ts 2>&1 | tail -10
```

Expected: `pass 6`, `fail 0`.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 208` (202 from Task 0 + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/utils/sqlUtils.ts src/utils/sqlUtils.test.ts
git commit -m "utils: add extractSelectColumns AST helper

Returns the set of column names + aliases available to row-level expressions
after a SELECT, plus a hasWildcard flag for SELECT * (where the caller cannot
enumerate columns and should skip verification). Foundation for PR7's
traitColumnReferenceRule."
```

---

## Task 2: `traitColumnReferenceRule`

**Files:**
- Create: `src/validation/rules/traitColumnReferenceRule.ts`
- Create: `src/validation/rules/traitColumnReferenceRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

For each resource type whose `list.query` parsed successfully and does not use `SELECT *`, walk every `list.map.traits.<role>.<field>` (including nested fields under `profile`, etc.). For each string leaf, extract column references and flag any that aren't in the SELECT set.

The BatonDocument exposes `rt.list?.query?.ast` (the parsed AST) and `rt.list?.map` (the raw map object including `traits`). See `document.ts:107-135` for `ResourceTypeDef.list` shape.

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/traitColumnReferenceRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traitColumnReferenceRule } from './traitColumnReferenceRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = traitColumnReferenceRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('trait-column-reference: trait that references a selected column is valid', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, login, email FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".login"
            emails: [".email"]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('trait-column-reference: SELECT * skips verification entirely', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT * FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".nonexistent_column"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('trait-column-reference: parse-failed query skips verification', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECTT id FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".nonexistent_column"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('trait-column-reference: trait references a non-selected column → diagnostic', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, login FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".email"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /\.email/);
  assert.match(results[0].errorMessage || '', /not selected/i);
});

test('trait-column-reference: multiple bad refs across nested fields produce multiple diagnostics', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, login FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".email"
            employee_ids: [".empid"]
            profile:
              department: ".dept"
`;
  const results = run(yaml).filter(r => !r.isValid);
  // .email, .empid, .dept all referenced but not selected → 3 diagnostics
  assert.equal(results.length, 3);
});

test('trait-column-reference: alias counts as available column', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, mail AS email FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".id"
        traits:
          user:
            emails: [".email"]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});
```

- [ ] **Step 2: Run, verify failures**

```bash
node --import tsx --test src/validation/rules/traitColumnReferenceRule.test.ts 2>&1 | tail -10
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/validation/rules/traitColumnReferenceRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { extractColumnRefs } from '../../utils/celUtils';
import { extractSelectColumns } from '../../utils/sqlUtils';

/**
 * Validates that every column referenced inside resource_types.<rt>.list.map.traits
 * is actually selected (or aliased) by the corresponding list.query. Skips when:
 *  - The list.query AST failed to parse (no ground truth to compare against).
 *  - The query uses SELECT * (every column might be present).
 *  - extractSelectColumns produces an empty set (unknown SELECT shape).
 *
 * Walks traits recursively (handles UserTraitMapping.profile which is an
 * arbitrary nested object, plus array-valued fields like emails/login_aliases).
 */
export const traitColumnReferenceRule: ValidationRule = {
  name: 'trait-column-reference',
  description: 'Validate trait expressions reference columns the list.query selects',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      const ast = rt.list?.query?.ast;
      if (!ast) continue;
      const map = rt.list?.map;
      if (!map || typeof map !== 'object') continue;
      const traits = map.traits;
      if (!traits || typeof traits !== 'object') continue;

      const { columns, hasWildcard } = extractSelectColumns(ast);
      if (hasWildcard) continue;
      if (columns.size === 0) continue;

      for (const role of Object.keys(traits)) {
        // eslint-disable-next-line security/detect-object-injection -- role is iterating own keys
        const roleMap = traits[role];
        walkTraitValue(roleMap, [rtId, role], columns, yamlContent, results);
      }
    }

    return results;
  },
};

/**
 * Recursively walks a trait value (which may be string, array, or nested object)
 * and flags column refs not present in `columns`. The `path` array is used only
 * for diagnostic messages.
 */
function walkTraitValue(
  value: unknown,
  path: string[],
  columns: Set<string>,
  yamlContent: string,
  results: ValidationResult[],
): void {
  if (typeof value === 'string') {
    const refs = extractColumnRefs(value);
    for (const ref of refs) {
      if (columns.has(ref)) continue;
      results.push({
        isValid: false,
        errorMessage: `Trait at resource_types.${path[0]}.list.map.traits.${path.slice(1).join('.')} references '.${ref}', but that column is not selected by list.query.`,
        lineNumber: findReferenceLine(yamlContent, value),
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
      walkTraitValue(value[i], [...path, String(i)], columns, yamlContent, results);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      // eslint-disable-next-line security/detect-object-injection -- k is iterating own keys
      walkTraitValue((value as Record<string, unknown>)[k], [...path, k], columns, yamlContent, results);
    }
    return;
  }
}

/**
 * Best-effort line anchor: find the line containing the trait expression value.
 * Falls back to undefined when not located.
 */
function findReferenceLine(yamlContent: string, exprValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // Escape the expression for use as a fixed substring match.
  const needle = exprValue.trim();
  if (needle.length === 0) return undefined;
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    if (lines[i].includes(needle)) return i;
  }
  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export:
```ts
export { traitColumnReferenceRule } from './traitColumnReferenceRule';
```

Add the import:
```ts
import { traitColumnReferenceRule } from './traitColumnReferenceRule';
```

Append to `allValidationRules` (after `entitlementIdReferenceRule`):
```ts
  traitColumnReferenceRule,
```

- [ ] **Step 5: Run unit tests, verify all 6 pass**

```bash
node --import tsx --test src/validation/rules/traitColumnReferenceRule.test.ts 2>&1 | tail -10
```

Expected: `pass 6`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: traitColumnReferenceRule fires for trait referencing unselected column', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, login FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            emails: [".email"]
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /\.email/.test(r.result.errorMessage || '') &&
    /not selected/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'traitColumnReferenceRule should fire via pipeline');
});
```

- [ ] **Step 7: Run full suite, verify 215 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 215` (208 from Task 1 + 6 unit + 1 pipeline = 215), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/traitColumnReferenceRule.ts src/validation/rules/traitColumnReferenceRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add traitColumnReferenceRule (document-scope)

Walks resource_types.<rt>.list.map.traits recursively and flags column refs
(via extractColumnRefs) that aren't selected (via extractSelectColumns) by
the corresponding list.query. Skips when AST parsing failed or SELECT *
is used."
```

---

## Task 3: `staticEntitlementIdUniquenessRule`

**Files:**
- Create: `src/validation/rules/staticEntitlementIdUniquenessRule.ts`
- Create: `src/validation/rules/staticEntitlementIdUniquenessRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

For each resource type, group `staticEntitlements` by `id` and flag every group with more than one entry.

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/staticEntitlementIdUniquenessRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticEntitlementIdUniquenessRule } from './staticEntitlementIdUniquenessRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = staticEntitlementIdUniquenessRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('static-entitlement-uniqueness: unique IDs are valid', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Member
        description: m
        purpose: permission
        grantable_to: [user]
      - id: admin
        display_name: Admin
        description: a
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('static-entitlement-uniqueness: empty static_entitlements is valid', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('static-entitlement-uniqueness: duplicate IDs within one RT → diagnostic per duplicate', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Member1
        description: m
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member2
        description: m
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  // One diagnostic flagging the second 'member' as duplicate.
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /member/);
  assert.match(results[0].errorMessage || '', /duplicate/i);
});

test('static-entitlement-uniqueness: same ID across different RTs is valid (per-RT scope)', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Group Member
        description: m
        purpose: permission
        grantable_to: [user]
  role:
    name: Role
    description: r
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Role Member
        description: m
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('static-entitlement-uniqueness: triple duplicate produces two diagnostics', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Member1
        description: m
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member2
        description: m
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member3
        description: m
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  // Two diagnostics — one per duplicate after the first occurrence.
  assert.equal(results.length, 2);
});
```

- [ ] **Step 2: Run, verify failures**

```bash
node --import tsx --test src/validation/rules/staticEntitlementIdUniquenessRule.test.ts 2>&1 | tail -10
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/validation/rules/staticEntitlementIdUniquenessRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates that static_entitlements[].id values are unique within each
 * resource_type. The connector treats the (resource_type, id) pair as the
 * entitlement's primary key, so a duplicate id within one resource type
 * silently drops one of the two configs.
 */
export const staticEntitlementIdUniquenessRule: ValidationRule = {
  name: 'static-entitlement-uniqueness',
  description: 'Validate static_entitlements[].id values are unique within each resource_type',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      const seen = new Set<string>();
      for (let i = 0; i < rt.staticEntitlements.length; i++) {
        // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
        const se = rt.staticEntitlements[i];
        const id = se.id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (!seen.has(id)) {
          seen.add(id);
          continue;
        }
        results.push({
          isValid: false,
          errorMessage: `Duplicate static_entitlements id '${id}' in resource_types.${rtId} (index ${i}).`,
          lineNumber: findDuplicateIdLine(yamlContent, rtId, id, i),
        });
      }
    }

    return results;
  },
};

/**
 * Best-effort line anchor: locate the n-th `id: <duplicate-value>` occurrence
 * under the named resource type's static_entitlements block.
 */
function findDuplicateIdLine(
  yamlContent: string,
  rtId: string,
  duplicateId: string,
  duplicateIndex: number,
): number | undefined {
  const lines = yamlContent.split('\n');
  let inRt = false;
  let inSE = false;
  let count = -1;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith(`${rtId}:`)) {
      inRt = true;
      inSE = false;
      count = -1;
      continue;
    }
    if (!inRt) continue;

    if (trimmed === 'static_entitlements:') {
      inSE = true;
      continue;
    }
    if (!inSE) continue;

    // Match `- id: <duplicateId>` or `id: <duplicateId>` on its own line.
    const trimmedNoDash = trimmed.startsWith('- ') ? trimmed.slice(2).trim() : trimmed;
    if (trimmedNoDash === `id: ${duplicateId}` || trimmedNoDash === `id: "${duplicateId}"` || trimmedNoDash === `id: '${duplicateId}'`) {
      count += 1;
      if (count === duplicateIndex) {
        return i;
      }
    }
  }

  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export:
```ts
export { staticEntitlementIdUniquenessRule } from './staticEntitlementIdUniquenessRule';
```

Add the import:
```ts
import { staticEntitlementIdUniquenessRule } from './staticEntitlementIdUniquenessRule';
```

Append to `allValidationRules` (after `traitColumnReferenceRule`):
```ts
  staticEntitlementIdUniquenessRule,
```

- [ ] **Step 5: Run unit tests, verify all 5 pass**

```bash
node --import tsx --test src/validation/rules/staticEntitlementIdUniquenessRule.test.ts 2>&1 | tail -10
```

Expected: `pass 5`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: staticEntitlementIdUniquenessRule fires for duplicate IDs', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: A
        description: a
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: B
        description: b
        purpose: permission
        grantable_to: [user]
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /member/.test(r.result.errorMessage || '') &&
    /duplicate/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'staticEntitlementIdUniquenessRule should fire via pipeline');
});
```

- [ ] **Step 7: Run full suite, verify 221 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 221` (215 from Task 2 + 5 unit + 1 pipeline = 221), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/staticEntitlementIdUniquenessRule.ts src/validation/rules/staticEntitlementIdUniquenessRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add staticEntitlementIdUniquenessRule (document-scope)

Flags duplicate static_entitlements[].id values within a single resource_type.
The connector treats (resource_type, id) as the entitlement primary key, so
a duplicate silently drops one config."
```

---

## Task 4: CHANGELOG + version bump 1.9.0 → 1.10.0

PR7 ships two new user-visible diagnostics + two shared utilities.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Verify suite, build, lint, audit**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 221`.

```bash
npm run build 2>&1 | tail -3
```
Expected: clean.

```bash
npm run lint 2>&1 | tail -3
```
Expected: 0 errors.

```bash
npm audit 2>&1 | tail -3
```
Expected: 0 vulnerabilities.

If any check fails, REPORT BACK with BLOCKED status.

- [ ] **Step 2: Bump version in `package.json`**

Find:
```json
  "version": "1.9.0",
```

Replace with:
```json
  "version": "1.10.0",
```

- [ ] **Step 3: Prepend CHANGELOG entry** above the existing `## [1.9.0]` section. Use today's date.

```markdown
## [1.10.0] - 2026-05-23

### Added

Two new document-scope validation rules with two supporting utility helpers:

- **`trait-column-reference`** — walks `resource_types.<rt>.list.map.traits` recursively and flags column references (e.g., `.email`) that aren't selected by the corresponding `list.query`. Skips when the query failed to parse, when the query uses `SELECT *`, or when the SELECT shape can't be enumerated.
- **`static-entitlement-uniqueness`** — flags duplicate `static_entitlements[].id` values within a single resource type. The connector treats `(resource_type, id)` as the entitlement primary key.

### Supporting utilities

- `extractColumnRefs(expr)` in `src/utils/celUtils.ts` — extracts top-level `.col` references from connector expressions while skipping chained accesses like `.profile.first_name`.
- `extractSelectColumns(ast)` in `src/utils/sqlUtils.ts` — returns the set of column names + aliases available to row-level expressions, plus a `hasWildcard` flag for `SELECT *`.

### Behavior deltas

Configs that reference an unselected column inside a trait expression, or duplicate a static entitlement ID within a resource type, now produce diagnostics in the editor. Configs with `SELECT *` or unparseable queries see no change.
```

- [ ] **Step 4: Verify tests still pass**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 221`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "release: bump to v1.10.0 — column-trait coherence rules"
```

- [ ] **Step 6: Package**

```bash
rm -f baton-sql-extension-*.vsix && npm run package 2>&1 | tail -3
```

Expected: `baton-sql-extension-1.10.0.vsix`.

---

## Self-review checklist

- [ ] `extractColumnRefs` in `src/utils/celUtils.ts` with 6 tests.
- [ ] `extractSelectColumns` appended to `src/utils/sqlUtils.ts`; new test file `src/utils/sqlUtils.test.ts` with 6 tests.
- [ ] Two new rules: `traitColumnReferenceRule`, `staticEntitlementIdUniquenessRule` — both `scope: 'document'`.
- [ ] Each rule registered in `src/validation/rules/index.ts`.
- [ ] Each rule returns `ValidationResult[]`.
- [ ] Each rule attempts to set `lineNumber`.
- [ ] No existing rule files modified.
- [ ] No edits to `pipeline.ts`, `document.ts`, `parsedQuery.ts`, etc.
- [ ] `npm test`: 221 passing.
- [ ] Version 1.10.0 + CHANGELOG entry.

## PR description template

```
PR7: Column-trait coherence (v1.10.0)

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-23-pr7-column-trait-coherence.md

PR7 of 8 in the SQL validation foundation series. The big one: ships a minimal
CEL/jq-style reference extractor and a SELECT-column extractor, then uses both
to detect dangling column references inside trait expressions.

New utilities:
- extractColumnRefs(expr) — top-level .col references from connector expressions
- extractSelectColumns(ast) — column names + aliases from a SELECT statement

New rules (both scope: 'document'):
- trait-column-reference: traits.<role>.<field> refs must be selected by list.query
- static-entitlement-uniqueness: static_entitlements[].id unique within a resource_type

What's NOT changed:
- No existing rule files modified.
- No edits to pipeline.ts, document.ts, parsedQuery.ts, etc.

Tests: 196 → 221 (+25).
```
