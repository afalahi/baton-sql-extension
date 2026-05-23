# PR6: Cross-Query References — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two document-scope validation rules that detect dangling cross-query references in `grants[].map[]`: a `principal_type` that names no defined resource type, and an `entitlement_id` that matches no defined entitlement. Both checks consume cross-document state that the BatonDocument walker (PR1) already populates.

**Architecture:** Two new rules, both `scope: 'document'`, both walking `ctx.document.resourceTypes` and inspecting each `grant.map[]` entry. Each rule treats the relevant field as a literal reference only when it looks like a plain identifier (matches `/^[a-zA-Z_][a-zA-Z0-9_:\-]*$/`); anything containing dots, quotes, operators, or whitespace is assumed to be a CEL/jq expression and skipped (would otherwise produce false positives). Literal-looking references are matched against the cross-document sets (`knownResourceTypeIds` and `definedEntitlementIds.literal`). When a value doesn't match and a close candidate exists (Levenshtein distance ≤ 2 via `areWordsSimilar`), the diagnostic includes a did-you-mean suggestion.

**Tech Stack:** TypeScript 4.x strict, `node:test` via `tsx`. Doc-scope rule infrastructure landed in PR1; doc-scope rule shape established by PR4 (`scopeEnumRule`, etc.) and PR5 (`actionQueryShapeRule`, etc.). BatonDocument's `definedEntitlementIds: { literal: Set<string>; expression: Set<string> }` and `knownResourceTypeIds: Set<string>` are pre-populated by `buildBatonDocument` (see `src/validation/document.ts:175-180` and `:231, :279, :339`).

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md` rollout row "PR6 — Cross-query references". Spec text:
> `grants[].map.entitlement_id` matched against `definedEntitlementIds.literal`; if the document has dynamic entitlements, expression-side gets a softer "not verifiable" hint rather than an error. `principal_type` references defined resource types via `knownResourceTypeIds`. ~200 LOC. New error categories.

**Spec rationale (line 282):**
> Static entitlements have literal IDs; dynamic ones are CEL expressions. A single Set forces PR6 to make either false-positive or false-negative tradeoffs. Splitting lets PR6 do honest best-effort matching.

**Design decision — when to skip vs. flag:**

| Field | When the value LOOKS literal | When it doesn't |
|---|---|---|
| `principal_type` | Match against `knownResourceTypeIds`. Flag mismatch. | Skip (assume CEL/jq expression). |
| `entitlement_id` (literal set non-empty) | Match against `definedEntitlementIds.literal`. Flag mismatch. | Skip. |
| `entitlement_id` (literal set empty, doc has only dynamic entitlements) | Skip entirely (too many false positives — every literal could be a column name). | Skip. |

`looksLikeLiteralReference` regex: `/^[a-zA-Z_][a-zA-Z0-9_:\-]*$/`. Catches identifiers and namespaced IDs (`role:admin`); excludes expressions with dots, quotes, operators, or whitespace.

**Behavior delta:** YES — new diagnostics for misnamed `principal_type` or `entitlement_id`. Conservative heuristic minimizes false positives on documents that use CEL expressions.

---

## File Structure

**New files:**
- `src/validation/rules/principalTypeReferenceRule.ts`
- `src/validation/rules/principalTypeReferenceRule.test.ts`
- `src/validation/rules/entitlementIdReferenceRule.ts`
- `src/validation/rules/entitlementIdReferenceRule.test.ts`

**Modified files:**
- `src/utils/stringUtils.ts` — add small `looksLikeLiteralReference` helper (single regex test, ~3 LOC + JSDoc)
- `src/validation/rules/index.ts` — export + import + array entry for each of the 2 new rules
- `src/validation/pipeline.test.ts` — append smoke tests for each new rule
- `CHANGELOG.md`
- `package.json` (version 1.8.0 → 1.9.0)

**Created (in addition to rule files):**
- `src/utils/stringUtils.test.ts` — new test file. There is currently no test file for `stringUtils.ts`; this PR creates it from scratch.

**Not touched:**
- Any of the 19 existing rule files
- `document.ts`, `parsedQuery.ts`, `pipeline.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`
- `src/server/`, `schemas/`, `snippets/`

**Tests after PR6:** 182 → 196 (Task 0: +2 stringUtils, Task 1: +6, Task 2: +6).

---

## Task 0: Shared helper `looksLikeLiteralReference`

This helper is used by both Task 1 and Task 2. Build it first so the rule tasks can lean on it.

**Files:**
- Modify: `src/utils/stringUtils.ts`
- Create: `src/utils/stringUtils.test.ts` — new file (no existing test file for stringUtils)

- [ ] **Step 1: Create `src/utils/stringUtils.test.ts`** with a full skeleton:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeLiteralReference } from './stringUtils';

test('looksLikeLiteralReference: plain identifiers are literal', () => {
  assert.equal(looksLikeLiteralReference('user'), true);
  assert.equal(looksLikeLiteralReference('group'), true);
  assert.equal(looksLikeLiteralReference('role_admin'), true);
  assert.equal(looksLikeLiteralReference('role:admin'), true);
  assert.equal(looksLikeLiteralReference('foo-bar'), true);
  assert.equal(looksLikeLiteralReference('_underscore'), true);
});

test('looksLikeLiteralReference: expressions and edge cases are not literal', () => {
  assert.equal(looksLikeLiteralReference('.column'), false);    // jq-style
  assert.equal(looksLikeLiteralReference('row.field'), false);  // dotted
  assert.equal(looksLikeLiteralReference('"user"'), false);     // quoted
  assert.equal(looksLikeLiteralReference("'user'"), false);     // quoted
  assert.equal(looksLikeLiteralReference('a || b'), false);     // operator + space
  assert.equal(looksLikeLiteralReference(''), false);           // empty
  assert.equal(looksLikeLiteralReference('1starts_with_digit'), false);
  assert.equal(looksLikeLiteralReference('foo:'), false);       // trailing colon
  assert.equal(looksLikeLiteralReference(':foo'), false);       // leading colon
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/utils/stringUtils.test.ts 2>&1 | tail -10
```

Expected: failures referencing `looksLikeLiteralReference is not defined` (or similar).

- [ ] **Step 3: Add the helper** to `src/utils/stringUtils.ts`:

```ts
/**
 * Whether a value looks like a literal reference (resource type ID, entitlement ID)
 * rather than a CEL/jq-style expression. Used by cross-query reference rules to
 * decide whether a value should be matched against a known-IDs set or skipped.
 *
 * Plain identifier or namespaced identifier (e.g., 'user', 'role:admin', 'foo-bar')
 * → literal. Anything containing dots, quotes, operators, whitespace, or trailing/
 * leading colons → expression. Each colon-separated segment must itself be a
 * non-empty identifier, so 'foo:' / ':foo' are rejected.
 */
export function looksLikeLiteralReference(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_\-]*(:[a-zA-Z_][a-zA-Z0-9_\-]*)*$/.test(s);
}
```

- [ ] **Step 4: Run, verify tests pass**

```bash
node --import tsx --test src/utils/stringUtils.test.ts 2>&1 | tail -5
```

Expected: `pass <N>`, `fail 0` (N is pre-existing stringUtils tests + 2 new).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 184` (182 baseline + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/utils/stringUtils.ts src/utils/stringUtils.test.ts
git commit -m "utils: add looksLikeLiteralReference helper

Shared helper for PR6's cross-query reference rules. Distinguishes plain
identifiers (matched against known-ID sets) from CEL/jq expressions (skipped
to avoid false positives)."
```

---

## Task 1: `principalTypeReferenceRule`

**Files:**
- Create: `src/validation/rules/principalTypeReferenceRule.ts`
- Create: `src/validation/rules/principalTypeReferenceRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

For each grant, walk `grant.map[]` (an array of GrantMapping objects). For each entry where `principal_type` is a literal-looking string, check it against `doc.knownResourceTypeIds`. Mismatch → diagnostic with optional did-you-mean.

The BatonDocument walker (`document.ts:323-329`) puts `g.map` directly onto `rt.grants[i].map` as `any` (it's a YAML array of objects).

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/principalTypeReferenceRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { principalTypeReferenceRule } from './principalTypeReferenceRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = principalTypeReferenceRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('principal-type-reference: literal that matches a known resource type is valid', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: user
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('principal-type-reference: expression-style value is skipped', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: ".type"
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('principal-type-reference: literal "useer" (typo) is rejected with did-you-mean', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: useer
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /useer/);
  assert.match(results[0].errorMessage || '', /Did you mean.*user/i);
});

test('principal-type-reference: literal with no close match flags without suggestion', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: department
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /department/);
  assert.match(results[0].errorMessage || '', /not a defined resource_type/i);
});

test('principal-type-reference: multiple offending mappings produce multiple diagnostics', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u1"
            principal_type: useer
            entitlement_id: ".perm"
          - principal_id: ".u2"
            principal_type: gruop
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/rules/principalTypeReferenceRule.test.ts 2>&1 | tail -15
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/validation/rules/principalTypeReferenceRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { looksLikeLiteralReference, areWordsSimilar, levenshteinDistance } from '../../utils/stringUtils';

/**
 * Flags grants[].map[].principal_type values that look like literal references
 * but don't name any defined resource_type. Expression-style values (with
 * dots, quotes, operators, etc.) are skipped to avoid false positives.
 */
export const principalTypeReferenceRule: ValidationRule = {
  name: 'principal-type-reference',
  description: 'Validate grants[].map[].principal_type references a defined resource_type',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    const known = doc.knownResourceTypeIds;
    if (known.size === 0) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      for (let gi = 0; gi < rt.grants.length; gi++) {
        // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
        const grant = rt.grants[gi];
        if (!Array.isArray(grant.map)) continue;

        for (let mi = 0; mi < grant.map.length; mi++) {
          // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
          const mapping = grant.map[mi];
          if (!mapping || typeof mapping !== 'object') continue;
          const value = mapping.principal_type;
          if (typeof value !== 'string' || value.length === 0) continue;
          if (!looksLikeLiteralReference(value)) continue;
          if (known.has(value)) continue;

          const suggestion = findClosestMatch(value, known);
          const message = suggestion
            ? `principal_type '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] is not a defined resource_type. Did you mean '${suggestion}'?`
            : `principal_type '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] is not a defined resource_type.`;

          results.push({
            isValid: false,
            errorMessage: message,
            lineNumber: findPrincipalTypeLine(yamlContent, value),
          });
        }
      }
    }

    return results;
  },
};

function findClosestMatch(value: string, candidates: Set<string>): string | undefined {
  const lower = value.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    if (!areWordsSimilar(lower, c.toLowerCase(), 2)) continue;
    const d = levenshteinDistance(lower, c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

function findPrincipalTypeLine(yamlContent: string, badValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // eslint-disable-next-line security/detect-non-literal-regexp -- badValue is matched as a fixed escaped string
  const pattern = new RegExp(`principal_type:\\s*['"]?${badValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export:
```ts
export { principalTypeReferenceRule } from './principalTypeReferenceRule';
```

Add the import:
```ts
import { principalTypeReferenceRule } from './principalTypeReferenceRule';
```

Append to `allValidationRules` (after `actionArgumentDefaultRule`):
```ts
  principalTypeReferenceRule,
```

- [ ] **Step 5: Run unit tests, verify all 5 pass**

```bash
node --import tsx --test src/validation/rules/principalTypeReferenceRule.test.ts 2>&1 | tail -15
```

Expected: `pass 5`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: principalTypeReferenceRule fires for typo principal_type', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: useer
            entitlement_id: ".perm"
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /useer/.test(r.result.errorMessage || '') &&
    /Did you mean.*user/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'principalTypeReferenceRule should fire for typo via pipeline');
});
```

- [ ] **Step 7: Run the full suite, verify 190 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 190` (184 from Task 0 + 5 unit + 1 pipeline = 190), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/principalTypeReferenceRule.ts src/validation/rules/principalTypeReferenceRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add principalTypeReferenceRule (document-scope)

Cross-document check: grants[].map[].principal_type values that look like
literal identifiers must name a defined resource_type. Expression-style
values (dotted, quoted, operator-containing) are skipped. Surfaces
did-you-mean suggestions via areWordsSimilar."
```

---

## Task 2: `entitlementIdReferenceRule`

**Files:**
- Create: `src/validation/rules/entitlementIdReferenceRule.ts`
- Create: `src/validation/rules/entitlementIdReferenceRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

Walks every `grant.map[].entitlement_id`. Behavior:

1. If the value is not literal-looking → skip.
2. If `definedEntitlementIds.literal` is empty (document uses only dynamic entitlements) → skip (high false-positive risk).
3. If literal value is in `definedEntitlementIds.literal` → pass.
4. Otherwise → diagnostic with optional did-you-mean against the literal set.

`definedEntitlementIds.literal` is populated from `static_entitlements[].id` (see `document.ts:339`). `definedEntitlementIds.expression` is populated from `entitlements.map[].id` (see `:279`). PR6 only matches against `.literal` — `.expression` is informational (a Set of template strings, often containing `{vars}` that won't match literal IDs anyway).

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/entitlementIdReferenceRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitlementIdReferenceRule } from './entitlementIdReferenceRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = entitlementIdReferenceRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('entitlement-id-reference: literal that matches a static_entitlements id is valid', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
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
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: member
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('entitlement-id-reference: expression-style value is skipped', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
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
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: ".role"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('entitlement-id-reference: documents with no static entitlements skip checks', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: admn
`;
  const results = run(yaml).filter(r => !r.isValid);
  // No static_entitlements anywhere → skip even literal-looking values.
  assert.equal(results.length, 0);
});

test('entitlement-id-reference: literal typo against literal set is rejected with did-you-mean', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: admin
        display_name: Admin
        description: a
        purpose: permission
        grantable_to: [user]
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: admn
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /admn/);
  assert.match(results[0].errorMessage || '', /Did you mean.*admin/i);
});

test('entitlement-id-reference: multiple offending mappings produce multiple diagnostics', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: admin
        display_name: Admin
        description: a
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member
        description: m
        purpose: permission
        grantable_to: [user]
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u1"
            principal_type: user
            entitlement_id: admn
          - principal_id: ".u2"
            principal_type: user
            entitlement_id: memba
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/rules/entitlementIdReferenceRule.test.ts 2>&1 | tail -15
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/validation/rules/entitlementIdReferenceRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { looksLikeLiteralReference, areWordsSimilar, levenshteinDistance } from '../../utils/stringUtils';

/**
 * Flags grants[].map[].entitlement_id values that look like literal references
 * but don't match any id in static_entitlements (definedEntitlementIds.literal).
 *
 * Skipped when:
 *  - The value is expression-style (dots, quotes, operators).
 *  - The document defines no static_entitlements (literal set is empty) — every
 *    literal-looking value could legitimately be a column name or template
 *    output, so flagging would produce too many false positives.
 *
 * Spec deviation: the spec (line 270) calls for a "softer 'not verifiable' hint"
 * on documents whose entitlements come from CEL expressions. ValidationResult
 * has no severity field yet (every diagnostic ships as an error), so PR6 takes
 * the safest conservative interpretation: skip entirely rather than over-report.
 * A future PR can add severity + promote this to an info/hint diagnostic.
 */
export const entitlementIdReferenceRule: ValidationRule = {
  name: 'entitlement-id-reference',
  description: 'Validate grants[].map[].entitlement_id references a defined entitlement',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    const literalIds = doc.definedEntitlementIds.literal;
    if (literalIds.size === 0) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      for (let gi = 0; gi < rt.grants.length; gi++) {
        // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
        const grant = rt.grants[gi];
        if (!Array.isArray(grant.map)) continue;

        for (let mi = 0; mi < grant.map.length; mi++) {
          // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
          const mapping = grant.map[mi];
          if (!mapping || typeof mapping !== 'object') continue;
          const value = mapping.entitlement_id;
          if (typeof value !== 'string' || value.length === 0) continue;
          if (!looksLikeLiteralReference(value)) continue;
          if (literalIds.has(value)) continue;

          const suggestion = findClosestMatch(value, literalIds);
          const message = suggestion
            ? `entitlement_id '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] does not match any defined entitlement. Did you mean '${suggestion}'?`
            : `entitlement_id '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] does not match any defined entitlement.`;

          results.push({
            isValid: false,
            errorMessage: message,
            lineNumber: findEntitlementIdLine(yamlContent, value),
          });
        }
      }
    }

    return results;
  },
};

function findClosestMatch(value: string, candidates: Set<string>): string | undefined {
  const lower = value.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    if (!areWordsSimilar(lower, c.toLowerCase(), 2)) continue;
    const d = levenshteinDistance(lower, c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

function findEntitlementIdLine(yamlContent: string, badValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // eslint-disable-next-line security/detect-non-literal-regexp -- badValue is matched as a fixed escaped string
  const pattern = new RegExp(`entitlement_id:\\s*['"]?${badValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export:
```ts
export { entitlementIdReferenceRule } from './entitlementIdReferenceRule';
```

Add the import:
```ts
import { entitlementIdReferenceRule } from './entitlementIdReferenceRule';
```

Append to `allValidationRules` (after `principalTypeReferenceRule`):
```ts
  entitlementIdReferenceRule,
```

- [ ] **Step 5: Run unit tests, verify all 5 pass**

```bash
node --import tsx --test src/validation/rules/entitlementIdReferenceRule.test.ts 2>&1 | tail -15
```

Expected: `pass 5`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: entitlementIdReferenceRule fires for typo entitlement_id', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: admin
        display_name: Admin
        description: a
        purpose: permission
        grantable_to: [user]
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: admn
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /admn/.test(r.result.errorMessage || '') &&
    /Did you mean.*admin/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'entitlementIdReferenceRule should fire for typo via pipeline');
});
```

- [ ] **Step 7: Run the full suite, verify 196 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 196` (190 from Task 1 + 5 unit + 1 pipeline = 196), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/entitlementIdReferenceRule.ts src/validation/rules/entitlementIdReferenceRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add entitlementIdReferenceRule (document-scope)

Cross-document check: grants[].map[].entitlement_id values that look like
literals must match an id in static_entitlements. Skips when the value is
expression-style, or when the document defines no static entitlements (would
produce too many false positives). Surfaces did-you-mean suggestions."
```

---

## Task 3: CHANGELOG + version bump 1.8.0 → 1.9.0

PR6 ships two new user-visible diagnostics + one shared util; minor version bump.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Verify suite, build, lint, audit**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 196`.

```bash
npm run build 2>&1 | tail -3
```
Expected: clean (1 pre-existing webpack warning OK).

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
  "version": "1.8.0",
```

Replace with:
```json
  "version": "1.9.0",
```

- [ ] **Step 3: Prepend CHANGELOG entry** above the existing `## [1.8.0]` section. Use today's date.

```markdown
## [1.9.0] - 2026-05-23

### Added

Two new document-scope validation rules covering cross-query reference integrity:

- **`principal-type-reference`** — flags `grants[].map[].principal_type` values that look like literal identifiers but don't name any defined `resource_types` key. Surfaces a `Did you mean '<resource_type>'?` suggestion when a close match exists (Levenshtein distance ≤ 2).
- **`entitlement-id-reference`** — flags `grants[].map[].entitlement_id` values that look like literals but don't match any `static_entitlements[].id` in the document. Skips entirely on documents that define no static entitlements (to avoid false positives in dynamic-entitlements-only configs). Surfaces a did-you-mean suggestion when applicable.

Both rules apply a conservative heuristic — values containing dots, quotes, operators, or whitespace are treated as CEL/jq expressions and skipped without checking.

### Behavior deltas

Configs that misspell a resource_type name in `principal_type`, or reference an entitlement that doesn't exist in `static_entitlements`, now produce diagnostics in the editor. Configs using expression-style references see no change.
```

- [ ] **Step 4: Verify tests still pass**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 196`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "release: bump to v1.9.0 — cross-query reference rules"
```

- [ ] **Step 6: Package**

```bash
rm -f baton-sql-extension-*.vsix && npm run package 2>&1 | tail -3
```

Expected: `baton-sql-extension-1.9.0.vsix`.

---

## Self-review checklist

- [ ] Shared helper `looksLikeLiteralReference` added to `stringUtils.ts` with 2 tests
- [ ] Two new rules: `principalTypeReferenceRule`, `entitlementIdReferenceRule` — both `scope: 'document'`, both reading `ctx.document`.
- [ ] Each rule registered in `src/validation/rules/index.ts` (export + import + array entry).
- [ ] Each rule returns `ValidationResult[]`.
- [ ] Each rule attempts to set `lineNumber`; falls back to `undefined` when not located.
- [ ] No existing rule files modified.
- [ ] No edits to `pipeline.ts`, `document.ts`, `parsedQuery.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`, `src/server/`.
- [ ] `npm test`: 196 passing.
- [ ] `npm run build`: clean.
- [ ] `npm run lint`: 0 errors.
- [ ] `npm audit`: clean.
- [ ] Version 1.9.0 + CHANGELOG entry.

## PR description template

```
PR6: Cross-query reference rules (v1.9.0)

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-23-pr6-cross-query-references.md

PR6 of 8 in the SQL validation foundation series. Adds two new document-scope
rules that detect dangling cross-query references in grants[].map[].

New rules (both scope: 'document'):
- principal-type-reference: principal_type must name a defined resource_type
- entitlement-id-reference: entitlement_id must match a static_entitlements id

Both use a conservative literal-vs-expression heuristic to avoid false positives
on CEL/jq expressions.

What's NOT changed:
- No existing rule files modified.
- No edits to pipeline.ts, document.ts, parsedQuery.ts, etc.
- No LSP feature provider, schema, snippets, or build config.

Tests: 182 → 196 (+14).
```
