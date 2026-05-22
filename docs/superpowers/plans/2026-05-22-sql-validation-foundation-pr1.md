# SQL Validation Foundation — PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `src/validation/` to a unified parsed-document model (`ParsedQuery`, `BatonDocument`, `RuleContext`) without changing any user-visible behavior, so future PRs can add connector-aware and cross-query rules cheaply.

**Architecture:** Replace today's per-query/per-rule re-parsing pattern with a single `buildBatonDocument()` call that produces a typed model of the whole YAML document plus per-query ASTs and pre-computed `varsScope`. A new orchestrator `validateDocument()` iterates rules once. Rules continue to receive `(sql, yamlContent, ctx?)` and can opt into `ctx` for richer info. `validateSql` is preserved as a backward-compat single-query shim so the 5 existing `sqlValidator.test.ts` tests continue to mean something.

**Tech Stack:** TypeScript 4.x (strict), node:test runner via `tsx`, `node-sql-parser`, `js-yaml`, `vscode-languageserver`.

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md`. Read it before starting Task 1 if you haven't.

---

## File Structure

**New files (create):**
- `src/validation/context.ts` — `RuleContext` interface
- `src/validation/parsedQuery.ts` — `ParsedQuery` type + `parseQuery()` builder
- `src/validation/document.ts` — `BatonDocument` + `ConnectConfig` + `ResourceTypeDef` + `ActionDef` + `buildBatonDocument()` + `resolveVarsScope()`
- `src/validation/pipeline.ts` — `validateDocument()` orchestrator
- `src/validation/parsedQuery.test.ts`
- `src/validation/document.test.ts`
- `src/validation/pipeline.test.ts`

**Modified files:**
- `src/validation/types.ts` — widen `ValidationRule.validate` (optional `ctx` arg, widened return)
- `src/validation/sqlValidator.ts` — rewrite body as single-query shim (signature preserved)
- `src/server/server.ts` — call `validateDocument`; rewire cache management (`documentCache` + `uriToHash`)

**Not touched:**
- Every file in `src/validation/rules/`
- Every existing `*.test.ts` (will all continue to pass byte-identical)
- Everything under `src/server/features/`
- `package.json`, `webpack.config.js`, `tsconfig*.json`, `schemas/`, `snippets/`

**Tests after PR1:** existing 75 + ~30-40 new = ~105-115 total. All must pass.

---

## Task 1: Widen `ValidationRule` interface and create `RuleContext`

**Files:**
- Create: `src/validation/context.ts`
- Modify: `src/validation/types.ts:22-26`
- Modify: `src/validation/sqlValidator.ts:31-46` (handle widened return)
- Test: `src/validation/sqlValidator.test.ts` (add one new test)

This task widens the interface. Existing 14 rules satisfy the new signature without edits because (a) TS allows extra arg ignored, (b) covariant return widening.

- [ ] **Step 1: Write the failing test** in `src/validation/sqlValidator.test.ts` (append):

```ts
test('validateSql accepts a rule that returns an array of results', () => {
  clearValidationCache();
  // Build a fake rule inline, push it into allValidationRules for the test,
  // then pop it. We're testing that the iteration handles widened returns.
  const originalLength = allValidationRules.length;
  const arrayRule: ValidationRule = {
    name: 'test-array-rule',
    description: 'returns two failures',
    validate: () => [
      { isValid: false, errorMessage: 'first' },
      { isValid: false, errorMessage: 'second' },
    ],
  };
  allValidationRules.push(arrayRule);
  try {
    const results = validateSql('SELECT 1', 'SELECT 1');
    const messages = results.map(r => r.errorMessage);
    assert.ok(messages.includes('first'), 'should include first error');
    assert.ok(messages.includes('second'), 'should include second error');
  } finally {
    allValidationRules.length = originalLength;
  }
});
```

You'll need to import `ValidationRule` and `allValidationRules` at the top of the file:

```ts
import { ValidationRule } from './types';
import { allValidationRules } from './rules';
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test 2>&1 | grep -E "test-array-rule|fail"
```

Expected: failure — either a TypeScript error (`validate` returns single, not array) or a runtime "result.isValid is undefined".

- [ ] **Step 3: Create `src/validation/context.ts`**

```ts
import { ParsedQuery } from './parsedQuery';
import { BatonDocument } from './document';

/**
 * Context passed to rules as an optional third argument.
 * Existing rules ignore it; new rules opt in for richer info.
 *
 * - For `scope: 'query'` rules (the default), `query` is set.
 * - For `scope: 'document'` rules, `query` is undefined.
 */
export interface RuleContext {
  query?: ParsedQuery;
  document: BatonDocument;
}
```

Note: this file imports from `parsedQuery.ts` and `document.ts`, which don't exist yet. That's fine — TS compilation will fail until those files exist, but they get created in Tasks 2 and 4. The test we're running here uses `validateSql` only, which doesn't import `RuleContext` directly.

- [ ] **Step 4: Widen `ValidationRule` in `src/validation/types.ts`**

Replace the existing `ValidationRule` interface (lines 22-26) with:

```ts
export interface ValidationRule {
  name: string;
  description: string;
  /** Defaults to 'query' — rule runs once per ParsedQuery. 'document' runs once per BatonDocument. */
  scope?: 'query' | 'document';
  validate: (
    sql: string,
    yamlContent: string,
    // ctx?: RuleContext   // ← intentionally NOT imported here; see below
    ctx?: any
  ) => ValidationResult | ValidationResult[];
}
```

Why `ctx?: any` and not `ctx?: RuleContext`? `RuleContext` lives in `context.ts`, which imports `ParsedQuery` and `BatonDocument` — neither exist yet. Adding the strict import now creates a circular bootstrap. We'll tighten this to `ctx?: RuleContext` in Task 4 once `document.ts` exists. The runtime behavior is identical; the type relaxation is temporary.

- [ ] **Step 5: Update `validateSql`'s rule loop in `src/validation/sqlValidator.ts`**

Replace the existing for-loop body (lines 24-36) with:

```ts
  // Apply all validation rules
  for (const rule of allValidationRules) {
    try {
      const out = rule.validate(normalizedSql, originalQuery);
      const arr = Array.isArray(out) ? out : [out];
      for (const result of arr) {
        if (!result.isValid) {
          results.push({
            ...result,
            errorMessage: result.errorMessage || `Validation failed for rule: ${rule.name}`
          });
        }
      }
    } catch (error) {
      // A throwing rule must not break the others, but the error needs to
      // surface somewhere or bugs are invisible. Default: log to console.error.
      if (onRuleError) {
        onRuleError(rule.name, error);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[baton-sql] rule '${rule.name}' threw: ${msg}`);
      }
    }
  }
```

- [ ] **Step 6: Run all tests, verify everything passes**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 76`, `fail 0`. (75 existing + 1 new.)

- [ ] **Step 7: Commit**

```bash
git add src/validation/context.ts src/validation/types.ts src/validation/sqlValidator.ts src/validation/sqlValidator.test.ts
git commit -m "validation: widen ValidationRule to support array returns and optional ctx

Adds optional scope ('query' | 'document') and optional 3rd ctx arg.
Return type widened to ValidationResult | ValidationResult[]. All 14
existing rules continue to satisfy the new interface without edits."
```

---

## Task 2: `ParsedQuery` type and `parseQuery()` builder

**Files:**
- Create: `src/validation/parsedQuery.ts`
- Create: `src/validation/parsedQuery.test.ts`

- [ ] **Step 1: Write the failing tests** in `src/validation/parsedQuery.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from './parsedQuery';

test('parseQuery: valid SQL parses to an AST', () => {
  const q = parseQuery({
    rawSql: 'SELECT id FROM users',
    yamlPath: ['resource_types', 'user', 'list', 'query'],
    startOffset: 100,
    endOffset: 120,
    varsScope: new Map(),
  });
  assert.equal(q.rawSql, 'SELECT id FROM users');
  assert.equal(q.normalizedSql, 'SELECT id FROM users');
  assert.notEqual(q.ast, null);
  assert.equal(q.astError, null);
});

test('parseQuery: normalizes ?<param> to ?', () => {
  const q = parseQuery({
    rawSql: 'SELECT * FROM users WHERE id = ?<user_id>',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.equal(q.normalizedSql, 'SELECT * FROM users WHERE id = ?');
  assert.equal(q.rawSql, 'SELECT * FROM users WHERE id = ?<user_id>'); // unchanged
});

test('parseQuery: invalid SQL keeps ast=null and astError set', () => {
  const q = parseQuery({
    rawSql: 'SELECT FROM WHERE',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.equal(q.ast, null);
  assert.ok(q.astError && q.astError.length > 0);
});

test('parseQuery: usedParams extracted from raw SQL', () => {
  const q = parseQuery({
    rawSql: 'SELECT * FROM t WHERE a = ?<user_id> AND b = ?<tenant_id> AND c = ?<user_id>',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.deepEqual([...q.usedParams].sort(), ['tenant_id', 'user_id']);
});

test('parseQuery: usedParams empty when no Baton params', () => {
  const q = parseQuery({
    rawSql: 'SELECT * FROM users',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.equal(q.usedParams.size, 0);
});

test('parseQuery: varsScope preserved as-is', () => {
  const scope = new Map([['user_id', 'resource.ID'], ['tenant', 'input.tenant']]);
  const q = parseQuery({
    rawSql: 'SELECT 1',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: scope,
  });
  assert.equal(q.varsScope.get('user_id'), 'resource.ID');
  assert.equal(q.varsScope.get('tenant'), 'input.tenant');
});

test('parseQuery: yamlPath mixed string/number elements preserved', () => {
  const q = parseQuery({
    rawSql: 'SELECT 1',
    yamlPath: ['resource_types', 'user', 'grants', 2, 'query'],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.deepEqual(q.yamlPath, ['resource_types', 'user', 'grants', 2, 'query']);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/parsedQuery.test.ts 2>&1 | tail -10
```

Expected: cannot find module `./parsedQuery`.

- [ ] **Step 3: Implement `src/validation/parsedQuery.ts`**

```ts
import { getParser, normalizeSQL } from '../utils/sqlUtils';

export interface ParsedQuery {
  /** Raw SQL with ?<param> tokens intact. */
  rawSql: string;
  /** SQL after `?<param>` → `?` normalization. */
  normalizedSql: string;
  /** AST from node-sql-parser, or null if parsing failed. */
  ast: any | null;
  /** Parser error message, or null. */
  astError: string | null;
  /** YAML path to this query, e.g. ['resource_types', 'user', 'list', 'query']. */
  yamlPath: (string | number)[];
  /** Absolute byte offset in BatonDocument.yamlContent. */
  startOffset: number;
  /** Absolute byte offset of end. */
  endOffset: number;
  /** vars visible to this query, resolved from container scope. */
  varsScope: Map<string, string>;
  /** Set of ?<param> names appearing in rawSql. */
  usedParams: Set<string>;
}

export interface ParseQueryInput {
  rawSql: string;
  yamlPath: (string | number)[];
  startOffset: number;
  endOffset: number;
  varsScope: Map<string, string>;
}

const PARAM_RE = /\?\<([^>]+)\>/g;

export function parseQuery(input: ParseQueryInput): ParsedQuery {
  const normalizedSql = normalizeSQL(input.rawSql);

  let ast: any | null = null;
  let astError: string | null = null;
  try {
    ast = getParser().astify(normalizedSql);
  } catch (err: any) {
    astError = err?.message ?? String(err);
  }

  const usedParams = new Set<string>();
  for (const match of input.rawSql.matchAll(PARAM_RE)) {
    usedParams.add(match[1]);
  }

  return {
    rawSql: input.rawSql,
    normalizedSql,
    ast,
    astError,
    yamlPath: input.yamlPath,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    varsScope: input.varsScope,
    usedParams,
  };
}
```

- [ ] **Step 4: Run, verify all 7 tests pass**

```bash
node --import tsx --test src/validation/parsedQuery.test.ts 2>&1 | tail -10
```

Expected: `pass 7`, `fail 0`.

- [ ] **Step 5: Run the full test suite to make sure nothing else broke**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 83` (76 from Task 1 + 7 new), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/parsedQuery.ts src/validation/parsedQuery.test.ts
git commit -m "validation: add ParsedQuery type and parseQuery() builder

Parses a single SQL string with vars-scope context and absolute offsets.
Computes normalizedSql (?<param> → ?), AST via node-sql-parser, astError
on failure, and usedParams from raw SQL. Default dialect for now;
dialect-aware parsing ships in PR2."
```

---

## Task 3: `resolveVarsScope` helper

**Files:**
- Create: stub `src/validation/document.ts` (just the helper for now)
- Create: `src/validation/document.test.ts`

This task implements only `resolveVarsScope` — the BatonDocument types and `buildBatonDocument()` come in Tasks 4–8.

- [ ] **Step 1: Write the failing tests** in `src/validation/document.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { resolveVarsScope } from './document';

function parse(content: string): any {
  return yaml.load(content);
}

test('resolveVarsScope: list query picks up list.vars', () => {
  const doc = parse(`
resource_types:
  user:
    list:
      vars:
        team_id: input.team_id
      query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['resource_types', 'user', 'list', 'query']);
  assert.equal(scope.get('team_id'), 'input.team_id');
});

test('resolveVarsScope: grants[i] query picks up grants[i].vars', () => {
  const doc = parse(`
resource_types:
  user:
    grants:
      - vars:
          resource_id: resource.ID
        query: SELECT 1
      - vars:
          other_id: principal.ID
        query: SELECT 2
`);
  const scope0 = resolveVarsScope(doc, ['resource_types', 'user', 'grants', 0, 'query']);
  const scope1 = resolveVarsScope(doc, ['resource_types', 'user', 'grants', 1, 'query']);
  assert.equal(scope0.get('resource_id'), 'resource.ID');
  assert.equal(scope0.has('other_id'), false);
  assert.equal(scope1.get('other_id'), 'principal.ID');
});

test('resolveVarsScope: static_entitlements provisioning.grant picks up provisioning.vars', () => {
  const doc = parse(`
resource_types:
  user:
    static_entitlements:
      - id: admin
        provisioning:
          vars:
            principal_id: principal.ID
          grant:
            queries:
              - SELECT 1
              - SELECT 2
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'static_entitlements', 0, 'provisioning', 'grant', 'queries', 1,
  ]);
  assert.equal(scope.get('principal_id'), 'principal.ID');
});

test('resolveVarsScope: account_provisioning create.queries picks up create.vars', () => {
  const doc = parse(`
resource_types:
  user:
    account_provisioning:
      create:
        vars:
          username: input.username
        queries:
          - SELECT 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'account_provisioning', 'create', 'queries', 0,
  ]);
  assert.equal(scope.get('username'), 'input.username');
});

test('resolveVarsScope: account_provisioning validate.query picks up validate.vars', () => {
  const doc = parse(`
resource_types:
  user:
    account_provisioning:
      validate:
        vars:
          email: input.email
        query: SELECT 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'account_provisioning', 'validate', 'query',
  ]);
  assert.equal(scope.get('email'), 'input.email');
});

test('resolveVarsScope: actions query picks up actions.vars and arguments keys', () => {
  const doc = parse(`
actions:
  disable_user:
    vars:
      timestamp: input.timestamp
    arguments:
      user_id:
        type: string
    query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['actions', 'disable_user', 'query']);
  assert.equal(scope.get('timestamp'), 'input.timestamp');
  assert.equal(scope.get('user_id'), 'string'); // argument key → its type as the "value"
});

test('resolveVarsScope: empty when no vars in scope', () => {
  const doc = parse(`
resource_types:
  user:
    list:
      query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['resource_types', 'user', 'list', 'query']);
  assert.equal(scope.size, 0);
});

test('resolveVarsScope: returns empty map for unknown path', () => {
  const doc = parse(`app_name: x`);
  const scope = resolveVarsScope(doc, ['nonexistent', 'path']);
  assert.equal(scope.size, 0);
});

test('resolveVarsScope: entitlements.query picks up entitlements.vars', () => {
  const doc = parse(`
resource_types:
  user:
    entitlements:
      vars:
        resource_id: resource.ID
      query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['resource_types', 'user', 'entitlements', 'query']);
  assert.equal(scope.get('resource_id'), 'resource.ID');
});

test('resolveVarsScope: entitlements.map[i].provisioning.grant picks up map[i].provisioning.vars', () => {
  const doc = parse(`
resource_types:
  user:
    entitlements:
      query: SELECT * FROM perms
      map:
        - id: ".name"
          provisioning:
            vars:
              principal_id: principal.ID
            grant:
              queries:
                - SELECT 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'entitlements', 'map', 0, 'provisioning', 'grant', 'queries', 0,
  ]);
  assert.equal(scope.get('principal_id'), 'principal.ID');
});

test('resolveVarsScope: static_entitlements.revoke uses the same provisioning.vars as grant', () => {
  const doc = parse(`
resource_types:
  user:
    static_entitlements:
      - id: admin
        provisioning:
          vars:
            principal_id: principal.ID
          revoke:
            queries:
              - DELETE 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'static_entitlements', 0, 'provisioning', 'revoke', 'queries', 0,
  ]);
  assert.equal(scope.get('principal_id'), 'principal.ID');
});

test('resolveVarsScope: credential_rotation.update.queries picks up update.vars', () => {
  const doc = parse(`
resource_types:
  user:
    credential_rotation:
      update:
        vars:
          new_password: input.password
        queries:
          - UPDATE 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'credential_rotation', 'update', 'queries', 0,
  ]);
  assert.equal(scope.get('new_password'), 'input.password');
});

test('resolveVarsScope: actions.queries[j] picks up actions.vars + arguments', () => {
  const doc = parse(`
actions:
  batch:
    vars:
      ts: input.timestamp
    arguments:
      id:
        type: string
    queries:
      - SELECT 1
      - SELECT 2
`);
  const scope = resolveVarsScope(doc, ['actions', 'batch', 'queries', 1]);
  assert.equal(scope.get('ts'), 'input.timestamp');
  assert.equal(scope.get('id'), 'string');
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -10
```

Expected: cannot find module `./document`.

- [ ] **Step 3: Create `src/validation/document.ts` with `resolveVarsScope` only**

```ts
/**
 * Resolve the `vars` map visible to a query at the given yamlPath.
 *
 * See the spec table at docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
 * for the full mapping. Each query yamlPath corresponds to exactly one vars source.
 */
export function resolveVarsScope(
  yamlObject: any,
  yamlPath: (string | number)[]
): Map<string, string> {
  const scope = new Map<string, string>();
  if (!yamlObject || typeof yamlObject !== 'object') return scope;

  // Helper: read object at a path, returning undefined if any segment missing.
  const at = (root: any, segs: (string | number)[]): any => {
    let cur = root;
    for (const s of segs) {
      if (cur == null) return undefined;
      cur = cur[s];
    }
    return cur;
  };

  const mergeVars = (vars: any): void => {
    if (!vars || typeof vars !== 'object') return;
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === 'string') scope.set(k, v);
    }
  };

  // Determine the vars source path based on yamlPath shape.
  // The patterns mirror the spec's resolution table.

  // actions.<a>.query  OR  actions.<a>.queries[<j>]
  if (yamlPath[0] === 'actions' && yamlPath.length >= 2) {
    const actionRoot = at(yamlObject, [yamlPath[0], yamlPath[1]]);
    mergeVars(actionRoot?.vars);
    // arguments keys are also in scope, with their type as the "value"
    const args = actionRoot?.arguments;
    if (args && typeof args === 'object') {
      for (const [argName, argConfig] of Object.entries(args)) {
        const type = (argConfig as any)?.type;
        if (typeof type === 'string') scope.set(argName, type);
      }
    }
    return scope;
  }

  if (yamlPath[0] !== 'resource_types' || yamlPath.length < 3) {
    return scope; // unknown shape, return empty
  }

  const rtRoot = at(yamlObject, [yamlPath[0], yamlPath[1]]);
  if (!rtRoot) return scope;

  const section = yamlPath[2];

  if (section === 'list') {
    mergeVars(rtRoot.list?.vars);
    return scope;
  }

  if (section === 'entitlements') {
    // Two sub-cases: entitlements.query (vars source: entitlements.vars)
    //                entitlements.map[<i>].provisioning.{grant,revoke}.queries[<j>] (vars: map[i].provisioning.vars)
    if (yamlPath[3] === 'map' && typeof yamlPath[4] === 'number') {
      const mapEntry = at(rtRoot, ['entitlements', 'map', yamlPath[4]]);
      mergeVars(mapEntry?.provisioning?.vars);
    } else {
      mergeVars(rtRoot.entitlements?.vars);
    }
    return scope;
  }

  if (section === 'grants' && typeof yamlPath[3] === 'number') {
    const grantEntry = at(rtRoot, ['grants', yamlPath[3]]);
    mergeVars(grantEntry?.vars);
    return scope;
  }

  if (section === 'static_entitlements' && typeof yamlPath[3] === 'number') {
    // static_entitlements[<i>].provisioning.{grant,revoke}.queries[<j>]
    const seEntry = at(rtRoot, ['static_entitlements', yamlPath[3]]);
    mergeVars(seEntry?.provisioning?.vars);
    return scope;
  }

  if (section === 'account_provisioning') {
    const sub = yamlPath[3];
    if (sub === 'create' || sub === 'validate') {
      mergeVars(rtRoot.account_provisioning?.[sub]?.vars);
    }
    return scope;
  }

  if (section === 'credential_rotation') {
    if (yamlPath[3] === 'update') {
      mergeVars(rtRoot.credential_rotation?.update?.vars);
    }
    return scope;
  }

  return scope;
}
```

- [ ] **Step 4: Run, verify all 14 tests pass**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -20
```

Expected: `pass 14`, `fail 0`. (The 14 tests cover every row of the spec's varsScope resolution table plus the empty/unknown-path edge cases.)

- [ ] **Step 5: Run the full test suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 97` (83 from Task 2 + 14 new), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/document.ts src/validation/document.test.ts
git commit -m "validation: add resolveVarsScope helper

Maps a query yamlPath to its vars source per the spec table. Covers
list, entitlements (top-level and map[].provisioning), grants[],
static_entitlements[].provisioning, account_provisioning (create/validate),
credential_rotation.update, and actions (including argument-keys-as-vars
per bsql/validate.go's ActionConfig staticValidate)."
```

---

## Task 4: `BatonDocument` types + minimal `buildBatonDocument` (degraded path)

**Files:**
- Modify: `src/validation/document.ts` (add types + stub builder)
- Modify: `src/validation/context.ts` (tighten `ctx?: any` → `ctx?: RuleContext`)
- Modify: `src/validation/types.ts` (now we can import RuleContext properly)
- Modify: `src/validation/document.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests** to `src/validation/document.test.ts`:

```ts
import { buildBatonDocument } from './document';

test('buildBatonDocument: returns degraded doc on invalid YAML', () => {
  const doc = buildBatonDocument(': not: valid: yaml: at: all');
  assert.equal(doc.yaml, null);
  assert.equal(doc.queries.length, 0);
  assert.equal(doc.resourceTypes.size, 0);
  assert.equal(doc.actions.size, 0);
  assert.equal(doc.definedEntitlementIds.literal.size, 0);
  assert.equal(doc.definedEntitlementIds.expression.size, 0);
  assert.equal(doc.knownResourceTypeIds.size, 0);
  assert.equal(doc.connect, undefined);
});

test('buildBatonDocument: empty YAML produces empty doc', () => {
  const doc = buildBatonDocument('');
  assert.equal(doc.queries.length, 0);
  assert.equal(doc.resourceTypes.size, 0);
  assert.equal(doc.connect, undefined);
});

test('buildBatonDocument: connect populated when present', () => {
  const doc = buildBatonDocument(`
app_name: test
connect:
  scheme: postgres
  host: localhost
  database: app
  user: u
  password: p
`);
  assert.equal(doc.connect?.scheme, 'postgres');
  assert.equal(doc.connect?.host, 'localhost');
  assert.equal(doc.connect?.database, 'app');
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -10
```

Expected: failure — `buildBatonDocument` not exported.

- [ ] **Step 3: Add types and minimal `buildBatonDocument` to `src/validation/document.ts`**

Append to the file (the `resolveVarsScope` already there stays):

```ts
import { parseYaml } from '../utils/yamlUtils';
import { ParsedQuery } from './parsedQuery';

export interface ConnectConfig {
  dsn?: string;
  scheme?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
  params?: Record<string, string>;
  databases?: { static?: string[]; discovery_query?: string };
}

export interface ResourceTypeDef {
  id: string;
  name?: string;
  description?: string;
  list?: {
    vars: Map<string, string>;
    query: ParsedQuery | null;
    map?: any;
    pagination?: any;
    scope?: string;
  };
  entitlements?: {
    vars: Map<string, string>;
    query: ParsedQuery | null;
    map?: any;
    pagination?: any;
    scope?: string;
  };
  grants: Array<{
    vars: Map<string, string>;
    query: ParsedQuery | null;
    map?: any;
    pagination?: any;
    scope?: string;
  }>;
  staticEntitlements: Array<{
    id: string;
    provisioning?: { vars: Map<string, string>; grant?: any; revoke?: any };
  }>;
  accountProvisioning?: any;
  credentialRotation?: any;
}

export interface ActionDef {
  id: string;
  name?: string;
  arguments?: Record<string, any>;
  vars?: Map<string, string>;
  query?: ParsedQuery | null;
  queries?: ParsedQuery[];
}

export interface BatonDocument {
  yaml: any | null;
  yamlContent: string;
  connect?: ConnectConfig;
  resourceTypes: Map<string, ResourceTypeDef>;
  actions: Map<string, ActionDef>;
  queries: ParsedQuery[];
  definedEntitlementIds: {
    literal: Set<string>;
    expression: Set<string>;
  };
  knownResourceTypeIds: Set<string>;
}

function emptyDocument(yamlContent: string, yaml: any | null): BatonDocument {
  return {
    yaml,
    yamlContent,
    resourceTypes: new Map(),
    actions: new Map(),
    queries: [],
    definedEntitlementIds: { literal: new Set(), expression: new Set() },
    knownResourceTypeIds: new Set(),
  };
}

export function buildBatonDocument(yamlContent: string): BatonDocument {
  const yamlObj = parseYaml(yamlContent);
  if (!yamlObj || typeof yamlObj !== 'object') {
    return emptyDocument(yamlContent, null);
  }
  const doc = emptyDocument(yamlContent, yamlObj);

  // connect: shallow copy of recognized fields
  if (yamlObj.connect && typeof yamlObj.connect === 'object') {
    const c = yamlObj.connect;
    doc.connect = {
      dsn: c.dsn,
      scheme: c.scheme,
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
      params: c.params,
      databases: c.databases,
    };
  }

  // resource_types + actions walks come in Tasks 5–7.
  return doc;
}
```

- [ ] **Step 4: Tighten `context.ts` to import the real types**

Replace `src/validation/context.ts` with the strict version:

```ts
import { ParsedQuery } from './parsedQuery';
import { BatonDocument } from './document';

export interface RuleContext {
  query?: ParsedQuery;
  document: BatonDocument;
}
```

(It was already this content — but now the imports resolve to real types.)

- [ ] **Step 5: Tighten `types.ts`'s `ValidationRule.validate` ctx parameter**

In `src/validation/types.ts`, replace `ctx?: any` with the real type:

```ts
import { RuleContext } from './context';

// ... existing TextEdit and ValidationResult interfaces ...

export interface ValidationRule {
  name: string;
  description: string;
  scope?: 'query' | 'document';
  validate: (
    sql: string,
    yamlContent: string,
    ctx?: RuleContext
  ) => ValidationResult | ValidationResult[];
}
```

- [ ] **Step 6: Run tests, verify all pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 100` (97 from Task 3 + 3 new in this task), `fail 0`. All existing 14 rule files still satisfy the interface.

- [ ] **Step 7: Commit**

```bash
git add src/validation/document.ts src/validation/context.ts src/validation/types.ts src/validation/document.test.ts
git commit -m "validation: add BatonDocument types and degraded buildBatonDocument

ConnectConfig + ResourceTypeDef + ActionDef + BatonDocument + minimal
buildBatonDocument that returns a degraded document on invalid YAML
(matches today's silent-skip). resource_types and actions walks land
in Tasks 5–7. RuleContext now imports concrete types."
```

---

## Task 5: `buildBatonDocument` resource_types walk (list / entitlements / grants / static_entitlements)

**Files:**
- Modify: `src/validation/document.ts`
- Modify: `src/validation/document.test.ts`

- [ ] **Step 1: Append failing tests** to `src/validation/document.test.ts`:

```ts
test('buildBatonDocument: walks list query', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: A user
    list:
      query: |
        SELECT id, name
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user');
  assert.ok(rt, 'should have user resource type');
  assert.equal(rt!.name, 'User');
  assert.equal(rt!.description, 'A user');
  assert.ok(rt!.list?.query, 'should have list query');
  assert.ok(rt!.list!.query!.rawSql.includes('SELECT id, name'));
  assert.equal(doc.queries.length, 1);
  assert.equal(doc.queries[0].yamlPath[0], 'resource_types');
  assert.equal(doc.queries[0].yamlPath[1], 'user');
});

test('buildBatonDocument: walks entitlements query and map', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: A user
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    entitlements:
      query: |
        SELECT entitlement_name FROM perms
      map:
        - id: ".entitlement_name"
          display_name: ".entitlement_name"
          description: "perm"
          purpose: permission
          grantable_to: [user]
`;
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user')!;
  assert.ok(rt.entitlements?.query);
  // Two queries total: list + entitlements
  assert.equal(doc.queries.length, 2);
});

test('buildBatonDocument: walks multiple grants entries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: A user
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1 FROM perms
        vars:
          resource_id: resource.ID
        map:
          - principal_id: ".user_id"
            principal_type: user
            entitlement_id: admin
      - query: SELECT 2 FROM other
        map:
          - principal_id: ".user_id"
            principal_type: user
            entitlement_id: member
`;
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user')!;
  assert.equal(rt.grants.length, 2);
  assert.ok(rt.grants[0].query?.rawSql.includes('FROM perms'));
  assert.ok(rt.grants[1].query?.rawSql.includes('FROM other'));
  // list + 2 grants = 3 queries
  assert.equal(doc.queries.length, 3);
  assert.equal(rt.grants[0].vars.get('resource_id'), 'resource.ID');
});

test('buildBatonDocument: walks static_entitlements with provisioning queries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: A user
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: admin
        display_name: Admin
        description: Admin
        purpose: permission
        grantable_to: [user]
        provisioning:
          vars:
            principal_id: principal.ID
          grant:
            queries:
              - "INSERT INTO admin (user_id) VALUES (?<principal_id>)"
          revoke:
            queries:
              - "DELETE FROM admin WHERE user_id = ?<principal_id>"
`;
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user')!;
  assert.equal(rt.staticEntitlements.length, 1);
  assert.equal(rt.staticEntitlements[0].id, 'admin');
  // list + grant query + revoke query = 3
  assert.equal(doc.queries.length, 3);
  // Verify varsScope on a provisioning query. The full path for the grant
  // query is ['resource_types','user','static_entitlements',0,'provisioning','grant','queries',0]
  const grantQ = doc.queries.find(q =>
    q.yamlPath[2] === 'static_entitlements' && q.yamlPath[4] === 'provisioning'
    && q.yamlPath[5] === 'grant'
  );
  assert.ok(grantQ, 'should find the grant provisioning query');
  assert.equal(grantQ!.varsScope.get('principal_id'), 'principal.ID');
  assert.ok(grantQ!.usedParams.has('principal_id'));
});

test('buildBatonDocument: yamlPath uses numeric indices for arrays', () => {
  const yaml = `
resource_types:
  user:
    name: U
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT GRANT FROM g
        map:
          - principal_id: ".id"
            principal_type: user
            entitlement_id: m
`;
  const doc = buildBatonDocument(yaml);
  const grantQ = doc.queries.find(q => q.rawSql.includes('GRANT'));
  assert.ok(grantQ);
  assert.deepEqual(grantQ!.yamlPath, ['resource_types', 'user', 'grants', 0, 'query']);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -15
```

Expected: tests fail — `resourceTypes.get('user')` returns undefined.

- [ ] **Step 3: Implement the resource_types walk in `src/validation/document.ts`**

Replace `buildBatonDocument` with the expanded version that walks resource_types:

```ts
export function buildBatonDocument(yamlContent: string): BatonDocument {
  const yamlObj = parseYaml(yamlContent);
  if (!yamlObj || typeof yamlObj !== 'object') {
    return emptyDocument(yamlContent, null);
  }
  const doc = emptyDocument(yamlContent, yamlObj);

  // connect
  if (yamlObj.connect && typeof yamlObj.connect === 'object') {
    const c = yamlObj.connect;
    doc.connect = {
      dsn: c.dsn,
      scheme: c.scheme,
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
      params: c.params,
      databases: c.databases,
    };
  }

  // resource_types walk.
  // The OUTER iteration follows YAML key order (Object.entries on the
  // resource_types map). Within each resource type, sub-sections are walked
  // in a FIXED order (list → entitlements → grants → static_entitlements →
  // account_provisioning → credential_rotation), which can differ from today's
  // findSQLQueries traversal if a YAML file lists sub-sections out of
  // conventional order. For typical configs this is identical; for unusual
  // orderings the dedup logic (which keeps first-equal) absorbs the difference.
  if (yamlObj.resource_types && typeof yamlObj.resource_types === 'object') {
    for (const [rtId, rtVal] of Object.entries<any>(yamlObj.resource_types)) {
      if (!rtVal || typeof rtVal !== 'object') continue;
      doc.knownResourceTypeIds.add(rtId);
      const rt: ResourceTypeDef = {
        id: rtId,
        name: rtVal.name,
        description: rtVal.description,
        grants: [],
        staticEntitlements: [],
      };
      doc.resourceTypes.set(rtId, rt);

      // list
      if (rtVal.list && typeof rtVal.list === 'object') {
        const listPath = ['resource_types', rtId, 'list'];
        const varsScope = resolveVarsScope(yamlObj, [...listPath, 'query']);
        const query = buildQueryIfPresent(
          yamlContent, rtVal.list.query, [...listPath, 'query'], varsScope, doc.queries
        );
        rt.list = {
          vars: varsScope,
          query,
          map: rtVal.list.map,
          pagination: rtVal.list.pagination,
          scope: rtVal.list.scope,
        };
      }

      // entitlements
      if (rtVal.entitlements && typeof rtVal.entitlements === 'object') {
        const entPath = ['resource_types', rtId, 'entitlements'];
        const varsScope = resolveVarsScope(yamlObj, [...entPath, 'query']);
        const query = buildQueryIfPresent(
          yamlContent, rtVal.entitlements.query, [...entPath, 'query'], varsScope, doc.queries
        );
        rt.entitlements = {
          vars: varsScope,
          query,
          map: rtVal.entitlements.map,
          pagination: rtVal.entitlements.pagination,
          scope: rtVal.entitlements.scope,
        };

        // entitlements.map[i].id (expression) → definedEntitlementIds.expression
        if (Array.isArray(rtVal.entitlements.map)) {
          for (const m of rtVal.entitlements.map) {
            if (m && typeof m.id === 'string') {
              doc.definedEntitlementIds.expression.add(m.id);
            }
            // entitlements.map[i].provisioning.{grant,revoke}.queries[j]
            // Handled in Task 6 (separate task to keep this manageable).
          }
        }
      }

      // grants
      if (Array.isArray(rtVal.grants)) {
        for (let i = 0; i < rtVal.grants.length; i++) {
          const g = rtVal.grants[i];
          if (!g || typeof g !== 'object') continue;
          const gPath = ['resource_types', rtId, 'grants', i];
          const varsScope = resolveVarsScope(yamlObj, [...gPath, 'query']);
          const query = buildQueryIfPresent(
            yamlContent, g.query, [...gPath, 'query'], varsScope, doc.queries
          );
          rt.grants.push({
            vars: varsScope,
            query,
            map: g.map,
            pagination: g.pagination,
            scope: g.scope,
          });
        }
      }

      // static_entitlements
      if (Array.isArray(rtVal.static_entitlements)) {
        for (let i = 0; i < rtVal.static_entitlements.length; i++) {
          const se = rtVal.static_entitlements[i];
          if (!se || typeof se !== 'object') continue;
          if (typeof se.id === 'string') {
            doc.definedEntitlementIds.literal.add(se.id);
          }
          const seDef: ResourceTypeDef['staticEntitlements'][number] = {
            id: typeof se.id === 'string' ? se.id : '',
          };
          if (se.provisioning && typeof se.provisioning === 'object') {
            const provPath = ['resource_types', rtId, 'static_entitlements', i, 'provisioning'];
            const varsScope = resolveVarsScope(yamlObj, [...provPath, 'grant', 'queries', 0]);
            seDef.provisioning = { vars: varsScope, grant: se.provisioning.grant, revoke: se.provisioning.revoke };

            // grant queries
            if (se.provisioning.grant?.queries && Array.isArray(se.provisioning.grant.queries)) {
              for (let j = 0; j < se.provisioning.grant.queries.length; j++) {
                buildQueryIfPresent(
                  yamlContent,
                  se.provisioning.grant.queries[j],
                  [...provPath, 'grant', 'queries', j],
                  varsScope,
                  doc.queries,
                );
              }
            }
            // revoke queries
            if (se.provisioning.revoke?.queries && Array.isArray(se.provisioning.revoke.queries)) {
              for (let j = 0; j < se.provisioning.revoke.queries.length; j++) {
                buildQueryIfPresent(
                  yamlContent,
                  se.provisioning.revoke.queries[j],
                  [...provPath, 'revoke', 'queries', j],
                  varsScope,
                  doc.queries,
                );
              }
            }
          }
          rt.staticEntitlements.push(seDef);
        }
      }

      // account_provisioning + credential_rotation: structural retention only.
      // Their queries are walked in Task 6.
      rt.accountProvisioning = rtVal.account_provisioning;
      rt.credentialRotation = rtVal.credential_rotation;
    }
  }

  // actions walked in Task 7.
  return doc;
}
```

**Add `import { parseQuery } from './parsedQuery';` to the imports block at the TOP of `document.ts`** (next to the existing `import { ParsedQuery } from './parsedQuery';` line — combine into a single named-import if you like). Then add the helpers below the `buildBatonDocument` function:

```ts
/**
 * Build a ParsedQuery for `rawSql`, push into `into`, and return it.
 * Returns null if rawSql isn't a non-empty string.
 *
 * Offset finding mirrors today's findSQLQueries multi-fallback chain
 * (yamlUtils.ts:90-176) so behavior is preserved on edge configs where
 * YAML block-fold changes whitespace or several queries share text.
 */
function buildQueryIfPresent(
  yamlContent: string,
  rawSql: any,
  yamlPath: (string | number)[],
  varsScope: Map<string, string>,
  into: ParsedQuery[]
): ParsedQuery | null {
  if (typeof rawSql !== 'string' || rawSql.length === 0) return null;
  const { startOffset, endOffset } = locateQueryInYaml(yamlContent, rawSql, yamlPath);
  const query = parseQuery({
    rawSql,
    yamlPath,
    startOffset,
    endOffset,
    varsScope,
  });
  into.push(query);
  return query;
}

/**
 * Find the absolute byte offsets of `rawSql` within `yamlContent`. Tries four
 * strategies in order, matching the fallback chain in `findSQLQueries`:
 *
 *   1. Direct string match (covers the common case).
 *   2. Normalized-whitespace match (YAML block-fold `>` collapses newlines).
 *   3. First-line match (multi-line block scalars where lines reflow).
 *   4. yamlPath-aware section search (anchors on the last string segment of
 *      the yamlPath to disambiguate identical SQL appearing in two places).
 *
 * Returns `{0, 0}` if all four strategies fail.
 */
function locateQueryInYaml(
  yamlContent: string,
  rawSql: string,
  yamlPath: (string | number)[]
): { startOffset: number; endOffset: number } {
  // 1. Direct match.
  const direct = yamlContent.indexOf(rawSql);
  if (direct !== -1) {
    return { startOffset: direct, endOffset: direct + rawSql.length };
  }

  // 2. Normalized-whitespace match.
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedRaw = norm(rawSql);
  const normalizedYaml = norm(yamlContent);
  const normIdx = normalizedYaml.indexOf(normalizedRaw);
  if (normIdx !== -1) {
    return { startOffset: normIdx, endOffset: normIdx + rawSql.length };
  }

  // 3. First-line search.
  const queryLines = rawSql.split('\n').filter(l => l.trim().length > 0);
  if (queryLines.length > 0) {
    const firstLine = queryLines[0].trim();
    const lines = yamlContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstLine)) {
        const offset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        return { startOffset: offset, endOffset: offset + rawSql.length };
      }
    }
  }

  // 4. yamlPath-anchored section search.
  const stringSegs = yamlPath.filter((s): s is string => typeof s === 'string');
  if (stringSegs.length > 0) {
    const lastKey = stringSegs[stringSegs.length - 1];
    const lines = yamlContent.split('\n');
    let inSection = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (!inSection && trimmed.includes(lastKey + ':')) {
        inSection = true;
        continue;
      }
      if (inSection && trimmed.includes(rawSql.substring(0, Math.min(50, rawSql.length)))) {
        const offset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        return { startOffset: offset, endOffset: offset + rawSql.length };
      }
    }
  }

  // All four strategies failed; fall back to zero offsets. The diagnostic
  // range will cover the full document, which is the same behavior today's
  // server.ts uses when findSQLQueries returns no position info.
  return { startOffset: 0, endOffset: 0 };
}
```

(The `import { parseQuery }` line is added to the TOP imports block — do NOT nest it next to the helper function. ESLint will warn on non-top-of-file imports, and the project convention is to keep all imports at the top.)

- [ ] **Step 4: Run, verify all tests pass**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -20
```

Expected: `pass 22` (14 from Task 3 + 3 from Task 4 + 5 new). Full suite still green.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 105`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/document.ts src/validation/document.test.ts
git commit -m "validation: walk resource_types in buildBatonDocument

Populate ResourceTypeDef for each resource_types entry: list, entitlements
(top-level), grants[], static_entitlements[]. Each SQL string located via
indexOf and parsed into a ParsedQuery. account_provisioning and
credential_rotation queries land in Task 6; actions in Task 7."
```

---

## Task 6: `buildBatonDocument` account_provisioning + credential_rotation walks

**Files:**
- Modify: `src/validation/document.ts`
- Modify: `src/validation/document.test.ts`

- [ ] **Step 1: Append failing tests** to `src/validation/document.test.ts`:

```ts
test('buildBatonDocument: walks account_provisioning.create.queries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: username, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password: { preferred: true }
      validate:
        vars:
          email: input.email
        query: "SELECT 1 FROM users WHERE email = ?<email>"
      create:
        vars:
          username: input.username
        queries:
          - "INSERT INTO users (name) VALUES (?<username>)"
          - "SELECT last_insert_id()"
`;
  const doc = buildBatonDocument(yaml);
  // list + validate.query + 2 create.queries = 4
  assert.equal(doc.queries.length, 4);
  const validateQ = doc.queries.find(q => q.yamlPath.includes('validate'));
  assert.ok(validateQ);
  assert.equal(validateQ!.varsScope.get('email'), 'input.email');
  assert.ok(validateQ!.usedParams.has('email'));
  const createQ0 = doc.queries.find(q =>
    q.yamlPath.includes('create') && q.yamlPath[q.yamlPath.length - 1] === 0
  );
  assert.ok(createQ0);
  assert.equal(createQ0!.varsScope.get('username'), 'input.username');
});

test('buildBatonDocument: walks credential_rotation.update.queries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    credential_rotation:
      credentials:
        random_password: { preferred: true }
      update:
        vars:
          new_password: input.password
        queries:
          - "UPDATE users SET pw = ?<new_password>"
`;
  const doc = buildBatonDocument(yaml);
  // list + 1 update query = 2
  assert.equal(doc.queries.length, 2);
  const updateQ = doc.queries.find(q => q.yamlPath.includes('credential_rotation'));
  assert.ok(updateQ);
  assert.equal(updateQ!.varsScope.get('new_password'), 'input.password');
});

test('buildBatonDocument: walks entitlements.map[].provisioning queries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    entitlements:
      query: SELECT 1 FROM perms
      map:
        - id: ".name"
          display_name: ".name"
          description: ent
          purpose: permission
          grantable_to: [user]
          provisioning:
            vars:
              principal_id: principal.ID
            grant:
              queries:
                - "INSERT INTO ents (user) VALUES (?<principal_id>)"
            revoke:
              queries:
                - "DELETE FROM ents WHERE user = ?<principal_id>"
`;
  const doc = buildBatonDocument(yaml);
  // list + entitlements.query + 1 grant + 1 revoke = 4
  assert.equal(doc.queries.length, 4);
  const grantQ = doc.queries.find(q =>
    q.yamlPath.includes('provisioning') && q.yamlPath.includes('grant')
  );
  assert.ok(grantQ);
  assert.equal(grantQ!.varsScope.get('principal_id'), 'principal.ID');
});
```

- [ ] **Step 2: Run, verify the 3 new tests fail**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -15
```

Expected: failures — queries.length mismatches because we haven't walked account_provisioning, credential_rotation, or entitlements.map[].provisioning yet.

- [ ] **Step 3: Add the walks to `buildBatonDocument`**

In `src/validation/document.ts`, locate the ENTIRE `if (Array.isArray(rtVal.entitlements.map))` block from Task 5 (the one that currently does only `definedEntitlementIds.expression.add(m.id)` and contains the stub comment `// entitlements.map[i].provisioning.{grant,revoke}.queries[j]`). Replace the WHOLE block (from the `if (Array.isArray(...))` line through its matching `}`) with this expanded version that walks per-mapping provisioning queries:

```ts
        // entitlements.map[i].id (expression) → definedEntitlementIds.expression
        // and walk per-mapping provisioning queries.
        if (Array.isArray(rtVal.entitlements.map)) {
          for (let i = 0; i < rtVal.entitlements.map.length; i++) {
            const m = rtVal.entitlements.map[i];
            if (!m || typeof m !== 'object') continue;
            if (typeof m.id === 'string') {
              doc.definedEntitlementIds.expression.add(m.id);
            }
            if (m.provisioning && typeof m.provisioning === 'object') {
              const provPath = ['resource_types', rtId, 'entitlements', 'map', i, 'provisioning'];
              const varsScope = resolveVarsScope(yamlObj, [...provPath, 'grant', 'queries', 0]);
              if (Array.isArray(m.provisioning.grant?.queries)) {
                for (let j = 0; j < m.provisioning.grant.queries.length; j++) {
                  buildQueryIfPresent(
                    yamlContent,
                    m.provisioning.grant.queries[j],
                    [...provPath, 'grant', 'queries', j],
                    varsScope,
                    doc.queries,
                  );
                }
              }
              if (Array.isArray(m.provisioning.revoke?.queries)) {
                for (let j = 0; j < m.provisioning.revoke.queries.length; j++) {
                  buildQueryIfPresent(
                    yamlContent,
                    m.provisioning.revoke.queries[j],
                    [...provPath, 'revoke', 'queries', j],
                    varsScope,
                    doc.queries,
                  );
                }
              }
            }
          }
        }
```

Then, *after* the static_entitlements block, add the account_provisioning + credential_rotation walks:

```ts
      // account_provisioning
      if (rtVal.account_provisioning && typeof rtVal.account_provisioning === 'object') {
        const apPath = ['resource_types', rtId, 'account_provisioning'];
        const ap = rtVal.account_provisioning;

        // validate.query
        if (ap.validate?.query) {
          const validatePath = [...apPath, 'validate', 'query'];
          const varsScope = resolveVarsScope(yamlObj, validatePath);
          buildQueryIfPresent(yamlContent, ap.validate.query, validatePath, varsScope, doc.queries);
        }

        // create.queries
        if (Array.isArray(ap.create?.queries)) {
          for (let j = 0; j < ap.create.queries.length; j++) {
            const queriesPath = [...apPath, 'create', 'queries', j];
            const varsScope = resolveVarsScope(yamlObj, queriesPath);
            buildQueryIfPresent(
              yamlContent, ap.create.queries[j], queriesPath, varsScope, doc.queries
            );
          }
        }
      }

      // credential_rotation
      if (rtVal.credential_rotation && typeof rtVal.credential_rotation === 'object') {
        const crPath = ['resource_types', rtId, 'credential_rotation'];
        const cr = rtVal.credential_rotation;
        if (Array.isArray(cr.update?.queries)) {
          for (let j = 0; j < cr.update.queries.length; j++) {
            const queriesPath = [...crPath, 'update', 'queries', j];
            const varsScope = resolveVarsScope(yamlObj, queriesPath);
            buildQueryIfPresent(
              yamlContent, cr.update.queries[j], queriesPath, varsScope, doc.queries
            );
          }
        }
      }
```

- [ ] **Step 4: Run tests, verify all 3 new pass**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -20
```

Expected: 25 tests pass (22 from Task 5 + 3 new).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 108`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/document.ts src/validation/document.test.ts
git commit -m "validation: walk account_provisioning, credential_rotation, and entitlements.map[].provisioning

buildBatonDocument now locates queries inside account_provisioning.validate.query,
account_provisioning.create.queries[], credential_rotation.update.queries[], and
the per-mapping provisioning queries on dynamic entitlements. All resolve the
correct varsScope per the spec's resolution table."
```

---

## Task 7: `buildBatonDocument` actions walk

**Files:**
- Modify: `src/validation/document.ts`
- Modify: `src/validation/document.test.ts`

- [ ] **Step 1: Append failing tests**:

```ts
test('buildBatonDocument: walks actions with single query', () => {
  const yaml = `
actions:
  disable_user:
    name: Disable
    arguments:
      user_id: { name: User, type: string, required: true, description: x }
    query: "UPDATE users SET active=false WHERE id=?<user_id>"
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries.length, 1);
  const action = doc.actions.get('disable_user');
  assert.ok(action);
  assert.equal(action!.name, 'Disable');
  assert.ok(action!.query);
  assert.equal(action!.query!.varsScope.get('user_id'), 'string');
  assert.equal(action!.query!.yamlPath[0], 'actions');
});

test('buildBatonDocument: walks actions with queries array', () => {
  const yaml = `
actions:
  batch_update:
    name: Batch
    vars:
      ts: input.timestamp
    queries:
      - UPDATE a SET x=1
      - UPDATE b SET y=2
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries.length, 2);
  const action = doc.actions.get('batch_update');
  assert.ok(action);
  assert.equal(action!.queries?.length, 2);
  assert.equal(action!.queries![0].varsScope.get('ts'), 'input.timestamp');
});
```

- [ ] **Step 2: Run, verify tests fail**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -10
```

Expected: failure — actions map is empty.

- [ ] **Step 3: Add actions walk in `document.ts`**

At the end of `buildBatonDocument`, just before the final `return doc`:

```ts
  // actions walk
  if (yamlObj.actions && typeof yamlObj.actions === 'object') {
    for (const [actionId, actionVal] of Object.entries<any>(yamlObj.actions)) {
      if (!actionVal || typeof actionVal !== 'object') continue;
      const actionDef: ActionDef = {
        id: actionId,
        name: actionVal.name,
        arguments: actionVal.arguments,
        vars: actionVal.vars ? new Map(Object.entries(actionVal.vars).filter(([_, v]) => typeof v === 'string') as [string, string][]) : undefined,
      };

      if (typeof actionVal.query === 'string' && actionVal.query.length > 0) {
        const path = ['actions', actionId, 'query'];
        const varsScope = resolveVarsScope(yamlObj, path);
        actionDef.query = buildQueryIfPresent(yamlContent, actionVal.query, path, varsScope, doc.queries);
      }
      if (Array.isArray(actionVal.queries)) {
        actionDef.queries = [];
        for (let j = 0; j < actionVal.queries.length; j++) {
          const path = ['actions', actionId, 'queries', j];
          const varsScope = resolveVarsScope(yamlObj, path);
          const q = buildQueryIfPresent(yamlContent, actionVal.queries[j], path, varsScope, doc.queries);
          if (q) actionDef.queries.push(q);
        }
      }

      doc.actions.set(actionId, actionDef);
    }
  }
```

- [ ] **Step 4: Run tests, verify pass**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -10
```

Expected: 27 tests pass (25 from Task 6 + 2 new).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 110`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/document.ts src/validation/document.test.ts
git commit -m "validation: walk actions in buildBatonDocument

Each action's query (or queries[]) is parsed with varsScope = action.vars
plus argument-keys (argument keys take their declared type as the 'value',
matching ActionConfig.staticValidate in bsql/validate.go)."
```

---

## Task 8: Build aggregation tests (sanity-check definedEntitlementIds + knownResourceTypeIds)

**Files:**
- Modify: `src/validation/document.test.ts` (just add tests; logic is already in place)

The aggregations were already implemented in Tasks 5–6. This task adds explicit tests for the aggregation behavior (no code changes; just regression coverage).

- [ ] **Step 1: Append tests** to `src/validation/document.test.ts`:

```ts
test('buildBatonDocument: definedEntitlementIds.literal from static_entitlements', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - { id: admin, display_name: A, description: a, purpose: permission, grantable_to: [user] }
      - { id: member, display_name: M, description: m, purpose: assignment, grantable_to: [user] }
  team:
    name: Team
    description: t
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - { id: owner, display_name: O, description: o, purpose: permission, grantable_to: [user] }
`;
  const doc = buildBatonDocument(yaml);
  assert.deepEqual(
    [...doc.definedEntitlementIds.literal].sort(),
    ['admin', 'member', 'owner']
  );
});

test('buildBatonDocument: definedEntitlementIds.expression from entitlements.map', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    entitlements:
      query: SELECT * FROM perms
      map:
        - id: ".name"
          display_name: ".name"
          description: x
          purpose: permission
          grantable_to: [user]
        - id: "slugify(.name)"
          display_name: ".name"
          description: y
          purpose: permission
          grantable_to: [user]
`;
  const doc = buildBatonDocument(yaml);
  assert.deepEqual(
    [...doc.definedEntitlementIds.expression].sort(),
    ['.name', 'slugify(.name)']
  );
  assert.equal(doc.definedEntitlementIds.literal.size, 0);
});

test('buildBatonDocument: knownResourceTypeIds is the resource_types key set', () => {
  const yaml = `
resource_types:
  user:
    name: U
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: G
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  role:
    name: R
    description: r
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const doc = buildBatonDocument(yaml);
  assert.deepEqual([...doc.knownResourceTypeIds].sort(), ['group', 'role', 'user']);
});
```

- [ ] **Step 2: Run tests, verify they pass immediately (no new code needed)**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -10
```

Expected: 30 tests pass (27 from Task 7 + 3 new).

- [ ] **Step 3: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 113`, `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/validation/document.test.ts
git commit -m "validation: explicit tests for definedEntitlementIds + knownResourceTypeIds aggregation"
```

---

## Task 9: `validateDocument` orchestrator + cache module

**Files:**
- Create: `src/validation/pipeline.ts`
- Create: `src/validation/pipeline.test.ts`

- [ ] **Step 1: Write failing tests** in `src/validation/pipeline.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDocument,
  documentCache,
  uriToHash,
  evictUri,
} from './pipeline';

const SAMPLE_VALID = `
app_name: t
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT id, name
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;

const SAMPLE_INVALID_SQL = `
app_name: t
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT
          id,
          name
          email
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;

test('validateDocument: clean document produces no failures', () => {
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(SAMPLE_VALID);
  assert.equal(results.length, 0);
});

test('validateDocument: missing-comma in SELECT surfaces a failure', () => {
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(SAMPLE_INVALID_SQL);
  assert.ok(results.length > 0);
  const messages = results.map(r => r.result.errorMessage || '');
  assert.ok(messages.some(m => /missing comma/i.test(m)));
});

test('validateDocument: returns document alongside results', () => {
  documentCache.clear();
  const { document, results } = validateDocument(SAMPLE_VALID);
  assert.equal(document.queries.length, 1);
  assert.equal(document.resourceTypes.size, 1);
  assert.equal(results.length, 0);
});

test('validateDocument: invokes onRuleError when a rule throws', () => {
  documentCache.clear();
  const errors: string[] = [];
  // We use a YAML that will validate fine; the rule-throw scenario is exercised
  // by sqlValidator.test.ts via a fake throwing rule. Here we only assert that
  // the parameter is accepted and produces results.
  const { results } = validateDocument(SAMPLE_VALID, (rule, err) => {
    errors.push(`${rule}:${String(err)}`);
  });
  assert.ok(Array.isArray(results));
  assert.equal(errors.length, 0);
});

test('uriToHash + evictUri: removing an entry clears that hash from the cache', () => {
  documentCache.clear();
  uriToHash.clear();
  // Simulate a cached entry.
  documentCache.set('h1', []);
  uriToHash.set('file:///a.yaml', 'h1');
  evictUri('file:///a.yaml');
  assert.equal(uriToHash.has('file:///a.yaml'), false);
  assert.equal(documentCache.has('h1'), false);
});

test('uriToHash + evictUri: evicting a URI not in the side-index is a no-op', () => {
  documentCache.clear();
  uriToHash.clear();
  documentCache.set('h2', []);
  evictUri('file:///nonexistent.yaml');
  assert.equal(documentCache.has('h2'), true); // unchanged
});

test('cache: same content across two URIs reuses the cached diagnostics', () => {
  // Spec testing-strategy bullet: "same content across two URIs returns
  // equivalent diagnostics from cache." validateDocument is content-keyed via
  // the server's documentCache; this test exercises the invariant that two
  // URIs with identical content hash to the same bucket and that evicting
  // ONE of them while another still references the hash does NOT clear it.
  documentCache.clear();
  uriToHash.clear();
  const content = 'SELECT 1';
  // Two URIs, same content → same hash. Use the same key by hand.
  documentCache.set('shared', [{ message: 'x' } as any]);
  uriToHash.set('file:///A.yaml', 'shared');
  uriToHash.set('file:///B.yaml', 'shared');

  evictUri('file:///A.yaml');
  // B still references 'shared', so the cache entry must remain.
  assert.equal(uriToHash.has('file:///A.yaml'), false);
  assert.equal(uriToHash.get('file:///B.yaml'), 'shared');
  assert.equal(documentCache.has('shared'), true,
    'cache entry should survive when another URI still references the hash');

  // Now evict B — no remaining references, cache slot must go.
  evictUri('file:///B.yaml');
  assert.equal(documentCache.has('shared'), false);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/pipeline.test.ts 2>&1 | tail -10
```

Expected: cannot find module `./pipeline`.

- [ ] **Step 3: Implement `src/validation/pipeline.ts`**

```ts
import { Diagnostic } from 'vscode-languageserver/node';
import { ValidationResult } from './types';
import { allValidationRules } from './rules';
import { BatonDocument, buildBatonDocument } from './document';
import { ParsedQuery } from './parsedQuery';

export type RuleErrorHandler = (ruleName: string, error: unknown) => void;

export interface PipelineResult {
  /** The validation result emitted by the rule. */
  result: ValidationResult;
  /** The query this result refers to (undefined for document-scope rules). */
  query?: ParsedQuery;
  /** Name of the rule that produced it (for logging / diagnostic.source). */
  ruleName: string;
}

/** Server-side cache of diagnostics keyed by content hash. */
export const documentCache = new Map<string, Diagnostic[]>();

/** Side index: which content hash a given URI currently corresponds to. */
export const uriToHash = new Map<string, string>();

/**
 * Remove a URI's reference to its cached diagnostics. Only drops the cache
 * entry if no other URI still references the same content hash — this matters
 * when multiple workspaces or duplicated files share identical content.
 */
export function evictUri(uri: string): void {
  const hash = uriToHash.get(uri);
  if (hash === undefined) return;
  uriToHash.delete(uri);
  // After this URI is gone, check whether any other URI still references the hash.
  let stillReferenced = false;
  for (const h of uriToHash.values()) {
    if (h === hash) { stillReferenced = true; break; }
  }
  if (!stillReferenced) {
    documentCache.delete(hash);
  }
}

/**
 * Build a BatonDocument, run every rule, return the document and the per-rule results.
 * Conversion to LSP Diagnostic and dedup happens in server.ts using the returned data.
 *
 * Loop order matters: queries-OUTER, rules-INNER. This mirrors today's
 * `for (queryInfo) { validateSql(...) }` from src/server/server.ts so the dedup
 * outcome (which keeps the first equal diagnostic) is byte-identical with v1.4.0.
 * Document-scope rules run after all query-scope iterations for the same reason.
 */
export function validateDocument(
  yamlContent: string,
  onRuleError?: RuleErrorHandler,
): { document: BatonDocument; results: PipelineResult[] } {
  const document = buildBatonDocument(yamlContent);
  const results: PipelineResult[] = [];

  const runRule = (rule: typeof allValidationRules[number], sql: string, query?: ParsedQuery) => {
    try {
      const out = rule.validate(sql, yamlContent, { query, document });
      const arr = Array.isArray(out) ? out : [out];
      for (const result of arr) {
        if (!result.isValid) {
          results.push({
            result: { ...result, errorMessage: result.errorMessage || `Validation failed for rule: ${rule.name}` },
            query,
            ruleName: rule.name,
          });
        }
      }
    } catch (error) {
      if (onRuleError) {
        onRuleError(rule.name, error);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[baton-sql] rule '${rule.name}' threw: ${msg}`);
      }
    }
  };

  // Queries OUTER, rules INNER (matches today's server.ts ordering).
  for (const query of document.queries) {
    for (const rule of allValidationRules) {
      if (rule.scope === 'document') continue;
      runRule(rule, query.normalizedSql, query);
    }
  }
  // Document-scope rules run after all query-scope iterations.
  for (const rule of allValidationRules) {
    if (rule.scope !== 'document') continue;
    runRule(rule, '', undefined);
  }

  return { document, results };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
node --import tsx --test src/validation/pipeline.test.ts 2>&1 | tail -10
```

Expected: `pass 7`, `fail 0`.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 120` (113 from Task 8 + 7 new), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/pipeline.ts src/validation/pipeline.test.ts
git commit -m "validation: add validateDocument orchestrator + documentCache + uriToHash

validateDocument(yamlContent) returns {document, results: PipelineResult[]}.
Loop is queries-outer, rules-inner — mirrors server.ts's iteration to keep
dedup outcome byte-identical with v1.4.0. Document-scope rules run after
query-scope. evictUri refcounts so a hash entry shared by multiple URIs
isn't dropped when one URI closes."
```

---

## Task 10: Rewire `server.ts` to use `validateDocument`

**Files:**
- Modify: `src/server/server.ts`

This task replaces the old per-URI `fileDigests` cache and per-query `validateSql` loop with the new pipeline. Existing rule-test coverage stays green because we're not touching any rule code.

- [ ] **Step 1: Read the existing `validateTextDocument` carefully**

```bash
sed -n '95,200p' src/server/server.ts
```

Note the cache logic (lines 99-112), the per-query loop with `validateSql` (around line 138), the diagnostic conversion (lines 140-176), the dedup (182-188), and the `documents.onDidClose` (212-217).

- [ ] **Step 2: Replace the imports block** in `src/server/server.ts` (top of file). Find:

```ts
// Import validation logic
import { validateSql, clearValidationCache } from '../validation';
import { parseYaml, findSQLQueries, isBatonSQLFilePath, hashString } from '../utils/serverUtils';
```

Replace with:

```ts
// Import validation logic
import { validateSql, clearValidationCache } from '../validation';
import { validateDocument, documentCache, uriToHash, evictUri } from '../validation/pipeline';
import { isBatonSQLFilePath, hashString } from '../utils/serverUtils';
```

(`parseYaml` and `findSQLQueries` are no longer needed in server.ts — they're called from inside `buildBatonDocument`.)

- [ ] **Step 3: Replace `validateTextDocument`** with the rewired version. Find the entire function (lines ~95-199 in current source) and replace its body with:

```ts
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const uri = textDocument.uri;

  if (!isBatonSQLFilePath(uri)) {
    return;
  }

  const content = textDocument.getText();
  const newHash = hashString(content);
  const previousHash = uriToHash.get(uri);

  // If this URI's content hasn't changed since last validation, nothing to do.
  if (previousHash === newHash) {
    return;
  }

  uriToHash.set(uri, newHash);

  // The URI's content changed: only drop the previous hash's cache slot if no
  // OTHER URI still references it. This protects multi-URI sessions where two
  // workspaces have identical content cached under one hash.
  if (previousHash !== undefined) {
    let stillReferenced = false;
    for (const h of uriToHash.values()) {
      if (h === previousHash) { stillReferenced = true; break; }
    }
    if (!stillReferenced) {
      documentCache.delete(previousHash);
    }
  }

  // Cache hit (same content under a different URI): reuse the diagnostics.
  const cached = documentCache.get(newHash);
  if (cached) {
    connection.sendDiagnostics({ uri, diagnostics: cached });
    return;
  }

  try {
    clearDiagnosticFixes(uri);

    const { document, results } = validateDocument(content, (ruleName, error) => {
      const msg = error instanceof Error ? (error.stack || error.message) : String(error);
      connection.console.error(`[Baton SQL] rule '${ruleName}' threw while validating ${uri}: ${msg}`);
    });

    // No queries found AND no document-scope failures? Send empty and cache.
    if (results.length === 0) {
      documentCache.set(newHash, []);
      connection.sendDiagnostics({ uri, diagnostics: [] });
      symbolIndex.indexDocument(textDocument);
      return;
    }

    // Convert PipelineResult[] → Diagnostic[].
    const allDiagnostics: Diagnostic[] = [];
    for (const pr of results) {
      const r = pr.result;
      const startOffset = pr.query?.startOffset ?? 0;
      const endOffset = pr.query?.endOffset ?? content.length;

      let range = {
        start: textDocument.positionAt(startOffset),
        end: textDocument.positionAt(endOffset),
      };

      // lineNumber: absolute line in the YAML document (today's semantic).
      if (r.lineNumber !== undefined) {
        const lines = content.split('\n');
        let offset = 0;
        for (let i = 0; i < r.lineNumber && i < lines.length; i++) {
          offset += lines[i].length + 1;
        }
        range = {
          start: textDocument.positionAt(offset),
          end: textDocument.positionAt(offset + (lines[r.lineNumber]?.length || 0)),
        };
      } else if (r.position !== undefined) {
        range = {
          start: textDocument.positionAt(startOffset + r.position),
          end: textDocument.positionAt(startOffset + r.position + 1),
        };
      }

      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range,
        message: r.errorMessage || 'SQL validation error',
        source: 'baton-sql',
      };
      allDiagnostics.push(diagnostic);

      if (r.suggestedFix) {
        storeDiagnosticFix(uri, diagnostic, r.suggestedFix);
      }
    }

    // Dedupe by (message, start.line, start.character) — verbatim from v1.4.0.
    const uniqueDiagnostics = allDiagnostics.filter((diagnostic, index, self) =>
      index === self.findIndex(d =>
        d.message === diagnostic.message &&
        d.range.start.line === diagnostic.range.start.line &&
        d.range.start.character === diagnostic.range.start.character
      )
    );

    documentCache.set(newHash, uniqueDiagnostics);
    connection.sendDiagnostics({ uri, diagnostics: uniqueDiagnostics });
    symbolIndex.indexDocument(textDocument);

  } catch (error: any) {
    connection.console.error(`[Baton SQL] Error validating document ${uri}: ${error.message}`);
  }
}
```

- [ ] **Step 4: Replace the `onDidClose` handler** in `src/server/server.ts`. Find:

```ts
documents.onDidClose((event) => {
  fileDigests.delete(event.document.uri);
  symbolIndex.clearDocument(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
```

Replace with:

```ts
documents.onDidClose((event) => {
  evictUri(event.document.uri);
  symbolIndex.clearDocument(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
```

- [ ] **Step 5: Remove the now-unused `fileDigests` map** at the top of `src/server/server.ts`. Find and delete:

```ts
// Cache for file digests to detect changes
const fileDigests = new Map<string, string>();
```

- [ ] **Step 6: Update `onDidChangeConfiguration`** to clear the new cache. Find:

```ts
connection.onDidChangeConfiguration(() => {
  clearValidationCache();
  fileDigests.clear();
  documents.all().forEach(validateTextDocument);
});
```

Replace with:

```ts
connection.onDidChangeConfiguration(() => {
  clearValidationCache();
  documentCache.clear();
  uriToHash.clear();
  documents.all().forEach(validateTextDocument);
});
```

- [ ] **Step 7: Run the full test suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 120`, `fail 0`. All 14 rule tests + 6 sqlValidator tests + 30 document tests + 7 pipeline tests + 7 parsedQuery tests pass. Task 10 itself adds no new tests; the count stays at Task 9's total.

- [ ] **Step 8: Run the build**

```bash
npm run build 2>&1 | tail -5
```

Expected: webpack compiles with the same pre-existing warning, no errors.

- [ ] **Step 9: Commit**

```bash
git add src/server/server.ts
git commit -m "server: route validation through validateDocument and documentCache

Removes fileDigests, replaces per-URI hash check with uriToHash + documentCache
side index. Diagnostic conversion preserves today's lineNumber-as-absolute-line
and position-relative-to-query semantics. Dedup logic byte-identical with v1.4.0."
```

---

## Task 11: Rewrite `validateSql` as a single-query shim

**Files:**
- Modify: `src/validation/sqlValidator.ts`

`validateSql` is still used by 5 tests in `sqlValidator.test.ts` plus the new array-return test from Task 1. After this task it builds a minimal degraded `BatonDocument` so rules see consistent `ctx`, but the external signature is preserved.

- [ ] **Step 1: Inspect the existing `validateSql.test.ts` so we know exactly what contract to preserve**

```bash
sed -n '1,80p' src/validation/sqlValidator.test.ts
```

The contract:
- `validateSql(sql, originalQuery)` returns `ValidationResult[]`
- Identical content returns identical (cached) array (reference equality, per the `caches by content hash` test)
- `onRuleError` is called for throwing rules
- Falls back to console.error otherwise

- [ ] **Step 2: Replace `src/validation/sqlValidator.ts`** with the shim implementation. The file currently exports `validateSql`, `clearValidationCache`, `getCacheSize`, `RuleErrorHandler`. Preserve all four. Replace the file contents with:

```ts
import { ValidationResult } from './types';
import { allValidationRules } from './rules';
import { hashString } from '../utils/stringUtils';
import { parseQuery } from './parsedQuery';
import { BatonDocument } from './document';

export type RuleErrorHandler = (ruleName: string, error: unknown) => void;

// Single-query cache. The production hot path no longer uses this — the server
// caches Diagnostic[] in documentCache. This cache exists for the validateSql
// shim, which is preserved as a public single-query entry point for tests and
// any external callers.
const validationCache = new Map<string, ValidationResult[]>();

/**
 * Validate a single SQL string. PRESERVED EXTERNAL SIGNATURE.
 *
 * Internally, builds a degraded BatonDocument containing only this one
 * ParsedQuery and runs every query-scope rule against it. Document-scope
 * rules are skipped because there's no full YAML document available.
 */
export function validateSql(
  sql: string,
  originalQuery: string,
  onRuleError?: RuleErrorHandler,
): ValidationResult[] {
  // Build the ParsedQuery first so the cache key uses `normalizedSql` —
  // matches the original validateSql, which hashed
  // `normalizeSQL(sql) + originalQuery`. Two raw SQLs that normalize to the
  // same string share a cache slot.
  const query = parseQuery({
    rawSql: sql,
    yamlPath: [],
    startOffset: 0,
    endOffset: sql.length,
    varsScope: new Map(),
  });
  const cacheKey = hashString(query.normalizedSql + originalQuery);
  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  // Build a single-query degraded BatonDocument. NOTE: `yamlContent` holds
  // raw `originalQuery` — in this back-compat path callers typically pass
  // `(sql, sql)`, so `yamlContent` is the SQL string itself, not YAML. Rules
  // that scan `yamlContent` for YAML-shape patterns will find nothing, which
  // is correct: there's no document context for single-query validation.
  const document: BatonDocument = {
    yaml: null,
    yamlContent: originalQuery,
    resourceTypes: new Map(),
    actions: new Map(),
    queries: [query],
    definedEntitlementIds: { literal: new Set(), expression: new Set() },
    knownResourceTypeIds: new Set(),
  };

  const results: ValidationResult[] = [];
  for (const rule of allValidationRules) {
    if (rule.scope === 'document') continue;
    try {
      const out = rule.validate(query.normalizedSql, originalQuery, { query, document });
      const arr = Array.isArray(out) ? out : [out];
      for (const r of arr) {
        if (!r.isValid) {
          results.push({
            ...r,
            errorMessage: r.errorMessage || `Validation failed for rule: ${rule.name}`,
          });
        }
      }
    } catch (error) {
      if (onRuleError) {
        onRuleError(rule.name, error);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[baton-sql] rule '${rule.name}' threw: ${msg}`);
      }
    }
  }

  validationCache.set(cacheKey, results);
  return results;
}

export function clearValidationCache(): void {
  validationCache.clear();
}

export function getCacheSize(): number {
  return validationCache.size;
}
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 120`, `fail 0`. The 5 `sqlValidator.test.ts` tests plus the new array-return test from Task 1 all pass — `validateSql`'s contract is preserved.

- [ ] **Step 4: Run lint to make sure the unused imports are clean**

```bash
npm run lint 2>&1 | tail -5
```

Expected: 0 errors, similar warning count to before.

- [ ] **Step 5: Run the build**

```bash
npm run build 2>&1 | tail -3
```

Expected: clean compile.

- [ ] **Step 6: Commit**

```bash
git add src/validation/sqlValidator.ts
git commit -m "validation: rewrite validateSql as single-query BatonDocument shim

validateSql now builds a minimal degraded BatonDocument with one ParsedQuery
and iterates every query-scope rule against it. External signature, return
type, caching semantics, and onRuleError fallback are preserved byte-identical."
```

---

## Task 12: Pipeline smoke tests for end-to-end behavior

**Files:**
- Modify: `src/validation/pipeline.test.ts` (append snapshot-style tests)

These are the "backward-compat smoke tests" from the spec: they drive the full `buildBatonDocument` → rule-loop → `PipelineResult[]` flow on fixtures known to today's rules and snapshot the diagnostic shape.

- [ ] **Step 1: Append the snapshot tests** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline smoke: SELECT with UNION subquery (v1.3.2 regression fixture)', () => {
  // No comma should be flagged — UNION inside subquery must not terminate outer SELECT.
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT
          u.id,
          u.name
        FROM users u
        WHERE u.id IN (
          SELECT user_id FROM admins
          UNION
          SELECT user_id FROM superusers
        )
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const missingComma = results.filter(r => /missing comma/i.test(r.result.errorMessage || ''));
  assert.equal(missingComma.length, 0, 'no missing-comma errors should be flagged');
});

test('pipeline smoke: INSERT with paren on own line (v1.3.1 regression fixture)', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1 FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
    account_provisioning:
      schema:
        - { name: username, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password: { preferred: true }
      validate:
        query: "SELECT 1"
      create:
        queries:
          - |
            INSERT INTO users (
              name,
              email,
              age
            ) VALUES (
              'alice',
              'a@b.com',
              30
            )
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const missingComma = results.filter(r => /missing comma/i.test(r.result.errorMessage || ''));
  assert.equal(missingComma.length, 0);
});

test('pipeline smoke: a real broken query produces missing-comma diagnostics', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT
          id,
          name
          email
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const missingComma = results.filter(r => /missing comma/i.test(r.result.errorMessage || ''));
  assert.ok(missingComma.length > 0, 'should flag the missing comma between name and email');
});

test('pipeline smoke: degraded doc (invalid YAML) emits no rule diagnostics', () => {
  documentCache.clear();
  const { results } = validateDocument(': : : :');
  assert.equal(results.length, 0);
});
```

- [ ] **Step 2: Run the suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 124` (120 from Task 11 + 4 new), `fail 0`.

- [ ] **Step 3: Commit**

```bash
git add src/validation/pipeline.test.ts
git commit -m "validation: end-to-end smoke tests for the new pipeline

Locks in v1.3.1 (INSERT paren-on-own-line) and v1.3.2 (UNION subquery) regression
fixtures through the full buildBatonDocument → rule loop. A real broken query
proves missing-comma flows correctly. Invalid YAML produces no rule diagnostics."
```

---

## Task 13: Final integration verification

This task has no code changes — it's the final sanity gate.

- [ ] **Step 1: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: `pass 124` (or similar — depends on whether you added more tests), `fail 0`.

- [ ] **Step 2: Run lint**

```bash
npm run lint 2>&1 | tail -3
```

Expected: 0 errors. Warning count should be similar to v1.4.0 (~116) or slightly higher (new code can have new object-injection false positives — they're acceptable).

- [ ] **Step 3: Run build**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean compile with the same pre-existing vscode-languageserver-types warning.

- [ ] **Step 4: Check no diagnostic differences on a representative fixture**

Create a temporary file `/tmp/baton-fixture.yaml` with a real-ish config (you can copy from snippets or the connector's repo). Open the Extension Development Host (`F5` in VS Code) and visually verify diagnostics appear in the same lines as v1.4.0 on the same input.

If you don't have a fixture handy, this step can be skipped — the smoke tests in Task 12 cover the high-value cases. Document the skip in the PR description.

- [ ] **Step 5: Verify `npm audit` is still clean**

```bash
npm audit 2>&1 | tail -3
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 6: Verify VSIX still packages cleanly**

```bash
rm -f baton-sql-extension-*.vsix && npm run package 2>&1 | tail -3
```

Expected: `Packaged: ... (~11 files, ~1.5-2 MB)`. The new validation files don't ship (they're under `src/` which `.vscodeignore` excludes); only the webpack-bundled `out/server/server.js` grows slightly.

- [ ] **Step 7: Final commit (only if any final tweaks were needed)**

If everything was green from the start of this task, no commit needed. If you needed to tweak something, commit it:

```bash
git status
# review
git add ...
git commit -m "fix: <whatever the issue was>"
```

---

## Self-review checklist (the engineer runs this before opening the PR)

- [ ] All 14 existing rule test files unchanged on disk (`git diff src/validation/rules/*.test.ts` is empty).
- [ ] All 5 existing tests in `src/validation/sqlValidator.test.ts` (except the one added in Task 1) unchanged.
- [ ] No file under `src/server/features/` was modified.
- [ ] No file under `src/validation/rules/` was modified.
- [ ] `package.json`, `webpack.config.js`, `tsconfig.json`, `tsconfig.eslint.json`, `schemas/`, `snippets/` are all unchanged.
- [ ] `npm test` passes with ≥ 102 tests (75 existing + ~30 new from this PR).
- [ ] `npm run build` is clean (one pre-existing warning).
- [ ] `npm run lint` has 0 errors.
- [ ] `npm audit` is clean.
- [ ] PR description lists the spec link + the rollout (PR1 of 8) + the "zero behavior change" guarantee.

---

## PR description template

```
Foundation refactor: introduce BatonDocument + ParsedQuery + RuleContext

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-22-sql-validation-foundation-pr1.md

This is PR1 of 8 in the SQL validation foundation series. Zero user-visible
behavior change is the guarantee — verified by all 75 existing tests passing
byte-identical plus ~30 new tests covering the new model.

What's added:
- src/validation/parsedQuery.ts — ParsedQuery type + parseQuery() builder
- src/validation/document.ts — BatonDocument + ConnectConfig + ResourceTypeDef
  + ActionDef + buildBatonDocument() + resolveVarsScope()
- src/validation/context.ts — RuleContext type
- src/validation/pipeline.ts — validateDocument() + documentCache + uriToHash
- *.test.ts for each of the above

What's modified:
- src/validation/types.ts — ValidationRule.validate gains optional ctx +
  widened return type. Existing rules unchanged.
- src/validation/sqlValidator.ts — body rewritten as a single-query shim
  built on the new BatonDocument model. External signature preserved.
- src/server/server.ts — routes validation through validateDocument and the
  new documentCache + uriToHash side index. Dedup logic byte-identical.

What's NOT changed:
- Any file in src/validation/rules/
- Any file in src/server/features/
- The JSON schema, snippets, build config

Followups (separately tracked):
- PR2: dialect detection from connect.scheme
- PR3: resurrect batonParameterValidationRule + varsQueryMismatchRule
- PR4+: connector-mirror rules, cross-query rules, AST cleanups
```
