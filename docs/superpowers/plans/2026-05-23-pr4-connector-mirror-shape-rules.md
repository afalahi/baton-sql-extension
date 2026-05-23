# PR4: Connector-Mirror Shape Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new document-scope validation rules that mirror static checks from `baton-sql/pkg/bsql/validate.go`. Users get fast in-editor feedback instead of waiting for the connector to fail at startup.

**Architecture:** Three new rules, each `scope: 'document'`, each consuming `ctx.document` (BatonDocument): (1) `scopeEnumRule` validates the `scope:` field on `list`/`entitlements`/`grants[]` is empty or `"cluster"` with did-you-mean for typos; (2) `randomPasswordConstraintsRule` validates each entry in `account_provisioning.credentials.random_password.constraints[]` has `char_set != ""` and `min_count > 0`; (3) `databasesConfigRule` enforces `connect.databases` has exactly one of `static` or `discovery_query`. All three rules locate line numbers by scanning `document.yamlContent` for the relevant pattern, fall back to no `lineNumber` when not found (server anchors to start of doc).

**Tech Stack:** TypeScript 4.x strict, `node:test` via `tsx`. Document-scope rules first introduced in PR1 — this is the first PR that actually adds doc-scope rules. Each rule returns `ValidationResult[]` since a single document can have multiple violations.

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md` (Rollout, "PR4 — Connector-mirror shape rules"). References to `bsql/validate.go`: `validateScope` (lines 37-44), `validatePasswordConstraints` (lines 117-127), `DatabasesConfig.Validate` (in `bsql/multidb.go`).

**Reference — what we're mirroring:**

```go
// validate.go:37-44
func validateScope(scope string) error {
    switch scope {
    case "", scopeCluster:
        return nil
    default:
        return fmt.Errorf("invalid scope %q: must be empty or %q", scope, scopeCluster)
    }
}

// validate.go:117-127
func validatePasswordConstraints(constraints []PasswordConstraintConfig) error {
    for i, c := range constraints {
        if c.CharSet == "" {
            return fmt.Errorf("random password constraint[%d]: char_set must not be empty", i)
        }
        if c.MinCount <= 0 {
            return fmt.Errorf("random password constraint[%d]: min_count must be greater than zero", i)
        }
    }
    return nil
}
```

`DatabasesConfig` from `bsql/config.go`: `static []string` XOR `discovery_query string`. The JSON schema already enforces this via `oneOf`; the rule provides faster feedback in the LSP.

**Behavior delta:** YES — new diagnostics. Configs with `scope: clustr` (typo), `constraints: [{char_set: "", min_count: 5}]`, or `databases: {static: [...], discovery_query: "..."}` now produce errors that didn't fire before.

---

## File Structure

**New files:**
- `src/validation/rules/scopeEnumRule.ts`
- `src/validation/rules/scopeEnumRule.test.ts`
- `src/validation/rules/randomPasswordConstraintsRule.ts`
- `src/validation/rules/randomPasswordConstraintsRule.test.ts`
- `src/validation/rules/databasesConfigRule.ts`
- `src/validation/rules/databasesConfigRule.test.ts`

**Modified files:**
- `src/validation/rules/index.ts` — export + array entry for each of the 3 new rules
- `src/validation/pipeline.test.ts` — append smoke tests for each new rule
- `CHANGELOG.md`
- `package.json` (version 1.6.0 → 1.7.0)

**Not touched:**
- Any of the 14 existing rule files
- `src/validation/document.ts`, `parsedQuery.ts`, `pipeline.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`
- `src/server/`, `schemas/`, `snippets/`

**Tests after PR4:** 154 → 169 (Task 1: +6, Task 2: +5, Task 3: +4).

---

## Task 1: `scopeEnumRule`

**Files:**
- Create: `src/validation/rules/scopeEnumRule.ts`
- Create: `src/validation/rules/scopeEnumRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

The `scope` field can appear on `list`, `entitlements`, and each `grants[]` entry. Valid values: empty string or `"cluster"`. Anything else is a typo. For values within Levenshtein distance 2 of `"cluster"`, suggest the correction.

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/scopeEnumRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeEnumRule } from './scopeEnumRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = scopeEnumRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

test('scope-enum: empty scope is valid', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml);
  assert.equal(results.filter(r => !r.isValid).length, 0);
});

test('scope-enum: scope=cluster is valid', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      scope: cluster
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml);
  assert.equal(results.filter(r => !r.isValid).length, 0);
});

test('scope-enum: typo "clustr" produces a did-you-mean diagnostic', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      scope: clustr
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /clustr/);
  assert.match(results[0].errorMessage || '', /Did you mean.*cluster/i);
});

test('scope-enum: unrecognized value without close match produces a generic diagnostic', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      scope: global
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /global/);
  assert.match(results[0].errorMessage || '', /must be empty or .*cluster/i);
});

test('scope-enum: checks scope on entitlements + grants[] independently', () => {
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
      scope: clustr
      query: SELECT 1
      map:
        - id: x
          display_name: x
          description: x
          purpose: permission
          grantable_to: [user]
    grants:
      - scope: wrong
        query: SELECT 1
        map:
          - principal_id: x
            principal_type: user
            entitlement_id: x
`;
  const results = run(yaml).filter(r => !r.isValid);
  // Two diagnostics: one for entitlements.scope=clustr, one for grants[0].scope=wrong.
  assert.equal(results.length, 2);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/rules/scopeEnumRule.test.ts 2>&1 | tail -15
```

Expected: cannot find module `./scopeEnumRule`.

- [ ] **Step 3: Implement `src/validation/rules/scopeEnumRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { areWordsSimilar } from '../../utils/stringUtils';

const VALID_SCOPES = new Set(['', 'cluster']);

/**
 * Validates the `scope:` field on list/entitlements/grants[]. Matches
 * baton-sql/pkg/bsql/validate.go's validateScope: only "" or "cluster" are
 * accepted. Anything else is a typo; if within Levenshtein distance 2 of
 * "cluster", surface a did-you-mean suggestion.
 */
export const scopeEnumRule: ValidationRule = {
  name: 'scope-enum',
  description: "Validate scope: field is empty or 'cluster'",
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    const checkScope = (scope: string | undefined, label: string) => {
      if (scope === undefined) return;
      if (VALID_SCOPES.has(scope)) return;
      const suggestion = areWordsSimilar(scope.toLowerCase(), 'cluster', 2)
        ? `Did you mean 'cluster'?`
        : `must be empty or 'cluster'.`;
      results.push({
        isValid: false,
        errorMessage: `Invalid scope '${scope}' on ${label}: ${suggestion}`,
        lineNumber: findScopeLineNumber(yamlContent, scope),
      });
    };

    for (const [rtId, rt] of doc.resourceTypes) {
      if (rt.list?.scope !== undefined) {
        checkScope(rt.list.scope, `resource_types.${rtId}.list.scope`);
      }
      if (rt.entitlements?.scope !== undefined) {
        checkScope(rt.entitlements.scope, `resource_types.${rtId}.entitlements.scope`);
      }
      for (let i = 0; i < rt.grants.length; i++) {
        if (rt.grants[i].scope !== undefined) {
          checkScope(rt.grants[i].scope, `resource_types.${rtId}.grants[${i}].scope`);
        }
      }
    }

    return results;
  },
};

/**
 * Locate the line in yamlContent that contains `scope: <bad-value>`.
 * Returns undefined when not found; caller's diagnostic anchors to the
 * default range in that case.
 */
function findScopeLineNumber(yamlContent: string, badValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // eslint-disable-next-line security/detect-non-literal-regexp -- badValue comes from typed BatonDocument, not user input through a vulnerable channel
  const pattern = new RegExp(`scope:\\s*['"]?${badValue.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export near the top, in alphabetical-ish position with the others:

```ts
export { scopeEnumRule } from './scopeEnumRule';
```

Add the import in the import block:

```ts
import { scopeEnumRule } from './scopeEnumRule';
```

Add to the `allValidationRules` array:

```ts
export const allValidationRules: ValidationRule[] = [
  // ... existing entries ...
  scopeEnumRule,
];
```

- [ ] **Step 5: Run unit tests, verify all 5 pass**

```bash
node --import tsx --test src/validation/rules/scopeEnumRule.test.ts 2>&1 | tail -15
```

Expected: `pass 5`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: scopeEnumRule fires for scope=clustr via the full pipeline', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      scope: clustr
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r => /Did you mean.*cluster/i.test(r.result.errorMessage || ''));
  assert.ok(matching.length > 0, 'scopeEnumRule should fire for typo via pipeline');
});
```

- [ ] **Step 7: Run the full suite, verify 160 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 160` (154 baseline + 5 unit + 1 pipeline = 160), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/scopeEnumRule.ts src/validation/rules/scopeEnumRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add scopeEnumRule (document-scope)

Mirrors bsql/validate.go's validateScope: scope: must be empty or 'cluster'.
Reports a did-you-mean suggestion when the value is within Levenshtein
distance 2 of 'cluster'. Checks list / entitlements / grants[] independently
so a doc with multiple misspellings gets multiple diagnostics."
```

---

## Task 2: `randomPasswordConstraintsRule`

**Files:**
- Create: `src/validation/rules/randomPasswordConstraintsRule.ts`
- Create: `src/validation/rules/randomPasswordConstraintsRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

Mirrors `bsql/validate.go`'s `validatePasswordConstraints`. Iterates `account_provisioning.credentials.random_password.constraints[]` on every resource type. Each entry must have `char_set` non-empty and `min_count > 0`.

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/randomPasswordConstraintsRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomPasswordConstraintsRule } from './randomPasswordConstraintsRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = randomPasswordConstraintsRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

test('random-password-constraints: well-formed constraints are valid', () => {
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
        - { name: u, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password:
          preferred: true
          constraints:
            - { char_set: "abc", min_count: 1 }
            - { char_set: "0123456789", min_count: 2 }
      validate:
        query: SELECT 1
      create:
        queries: [ "INSERT INTO users (id) VALUES (1)" ]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('random-password-constraints: no random_password block is valid (no-op)', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('random-password-constraints: empty char_set is rejected', () => {
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
        - { name: u, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password:
          preferred: true
          constraints:
            - { char_set: "", min_count: 2 }
      validate:
        query: SELECT 1
      create:
        queries: [ "INSERT INTO users (id) VALUES (1)" ]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /char_set/);
  assert.match(results[0].errorMessage || '', /empty|non-empty/i);
});

test('random-password-constraints: min_count <= 0 is rejected', () => {
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
        - { name: u, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password:
          preferred: true
          constraints:
            - { char_set: "abc", min_count: 0 }
      validate:
        query: SELECT 1
      create:
        queries: [ "INSERT INTO users (id) VALUES (1)" ]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /min_count/);
  assert.match(results[0].errorMessage || '', /greater than zero|> 0/);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/rules/randomPasswordConstraintsRule.test.ts 2>&1 | tail -15
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/validation/rules/randomPasswordConstraintsRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Mirrors bsql/validate.go's validatePasswordConstraints. Walks each
 * resource type's account_provisioning.credentials.random_password.constraints
 * and reports any entry with empty char_set or min_count <= 0.
 */
export const randomPasswordConstraintsRule: ValidationRule = {
  name: 'random-password-constraints',
  description: 'Validate account_provisioning.credentials.random_password.constraints',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      const constraints = rt.accountProvisioning?.credentials?.random_password?.constraints;
      if (!Array.isArray(constraints)) continue;

      for (let i = 0; i < constraints.length; i++) {
        const c = constraints[i];
        if (!c || typeof c !== 'object') continue;

        const charSet = c.char_set;
        const minCount = c.min_count;

        if (typeof charSet !== 'string' || charSet === '') {
          results.push({
            isValid: false,
            errorMessage: `random password constraint[${i}] in resource_types.${rtId}: char_set must be non-empty.`,
            lineNumber: findConstraintLineNumber(yamlContent, rtId, i, 'char_set'),
          });
        }

        if (typeof minCount !== 'number' || minCount <= 0) {
          results.push({
            isValid: false,
            errorMessage: `random password constraint[${i}] in resource_types.${rtId}: min_count must be greater than zero.`,
            lineNumber: findConstraintLineNumber(yamlContent, rtId, i, 'min_count'),
          });
        }
      }
    }

    return results;
  },
};

/**
 * Best-effort line anchor: walks yamlContent looking for the key (`char_set:`
 * or `min_count:`) under a constraints: block inside the named resource type's
 * random_password section. Returns undefined on failure so the server uses
 * its default range.
 */
function findConstraintLineNumber(
  yamlContent: string,
  rtId: string,
  constraintIndex: number,
  key: 'char_set' | 'min_count'
): number | undefined {
  const lines = yamlContent.split('\n');
  let inRt = false;
  let inConstraints = false;
  let dashCount = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith(`${rtId}:`)) {
      inRt = true;
      inConstraints = false;
      dashCount = -1;
      continue;
    }
    if (!inRt) continue;

    if (trimmed === 'constraints:') {
      inConstraints = true;
      dashCount = -1;
      continue;
    }
    if (!inConstraints) continue;

    if (trimmed.startsWith('- ')) {
      dashCount += 1;
      if (dashCount === constraintIndex && trimmed.includes(`${key}:`)) {
        return i;
      }
      continue;
    }
    if (dashCount === constraintIndex && trimmed.startsWith(`${key}:`)) {
      return i;
    }
  }

  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export:

```ts
export { randomPasswordConstraintsRule } from './randomPasswordConstraintsRule';
```

Add the import:

```ts
import { randomPasswordConstraintsRule } from './randomPasswordConstraintsRule';
```

Add to the `allValidationRules` array:

```ts
  randomPasswordConstraintsRule,
```

- [ ] **Step 5: Run unit tests, verify all 4 pass**

```bash
node --import tsx --test src/validation/rules/randomPasswordConstraintsRule.test.ts 2>&1 | tail -15
```

Expected: `pass 4`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: randomPasswordConstraintsRule fires for empty char_set via the full pipeline', () => {
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
        - { name: u, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password:
          preferred: true
          constraints:
            - { char_set: "", min_count: 5 }
      validate:
        query: SELECT 1
      create:
        queries: [ "INSERT INTO users (id) VALUES (1)" ]
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /char_set/.test(r.result.errorMessage || '') &&
    /empty|non-empty/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'randomPasswordConstraintsRule should fire for empty char_set');
});
```

- [ ] **Step 7: Run the full suite, verify 165 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 165` (160 from Task 1 + 4 unit + 1 pipeline = 165), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/randomPasswordConstraintsRule.ts src/validation/rules/randomPasswordConstraintsRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add randomPasswordConstraintsRule (document-scope)

Mirrors bsql/validate.go's validatePasswordConstraints. Walks each resource
type's account_provisioning.credentials.random_password.constraints[] and
flags any entry with empty char_set or min_count <= 0."
```

---

## Task 3: `databasesConfigRule`

**Files:**
- Create: `src/validation/rules/databasesConfigRule.ts`
- Create: `src/validation/rules/databasesConfigRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

`connect.databases` opts the connector into per-database iteration. The user must provide EITHER a static list of database names OR a discovery_query — but not both, and not neither. The JSON schema already enforces this via `oneOf`; this rule provides faster in-editor feedback.

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/databasesConfigRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databasesConfigRule } from './databasesConfigRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = databasesConfigRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

test('databases-config: no databases block is valid', () => {
  const yaml = `
connect:
  dsn: postgres://x
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('databases-config: only static is valid', () => {
  const yaml = `
connect:
  dsn: postgres://x
  databases:
    static:
      - app
      - reports
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('databases-config: only discovery_query is valid', () => {
  const yaml = `
connect:
  dsn: postgres://x
  databases:
    discovery_query: "SELECT datname FROM pg_database"
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('databases-config: both static AND discovery_query is rejected', () => {
  const yaml = `
connect:
  dsn: postgres://x
  databases:
    static: [a, b]
    discovery_query: "SELECT datname FROM pg_database"
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /static.*discovery_query|exactly one/i);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/rules/databasesConfigRule.test.ts 2>&1 | tail -15
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/validation/rules/databasesConfigRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates connect.databases (per-database iteration config): exactly one of
 * `static` (a non-empty array of database names) or `discovery_query` (a
 * non-empty SQL string). The JSON schema enforces the same constraint via
 * oneOf; this rule provides faster in-editor feedback.
 */
export const databasesConfigRule: ValidationRule = {
  name: 'databases-config',
  description: 'Validate connect.databases has exactly one of static or discovery_query',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const databases = ctx?.document?.connect?.databases;
    if (!databases) return results;

    const hasStatic = Array.isArray(databases.static) && databases.static.length > 0;
    const hasDiscovery =
      typeof databases.discovery_query === 'string' && databases.discovery_query.length > 0;

    if (hasStatic && hasDiscovery) {
      results.push({
        isValid: false,
        errorMessage:
          "connect.databases must specify exactly one of 'static' or 'discovery_query', not both.",
        lineNumber: findDatabasesLineNumber(yamlContent),
      });
    }

    return results;
  },
};

function findDatabasesLineNumber(yamlContent: string): number | undefined {
  const lines = yamlContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*databases:\s*$/.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export:

```ts
export { databasesConfigRule } from './databasesConfigRule';
```

Add the import:

```ts
import { databasesConfigRule } from './databasesConfigRule';
```

Add to the `allValidationRules` array:

```ts
  databasesConfigRule,
```

- [ ] **Step 5: Run unit tests, verify all 4 pass**

```bash
node --import tsx --test src/validation/rules/databasesConfigRule.test.ts 2>&1 | tail -15
```

Expected: `pass 4`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: databasesConfigRule fires when both static and discovery_query are set', () => {
  const yaml = `
connect:
  dsn: postgres://x
  databases:
    static: [a, b]
    discovery_query: "SELECT datname FROM pg_database"
resource_types: {}
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /exactly one|static.*discovery_query/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'databasesConfigRule should fire when both are set');
});
```

- [ ] **Step 7: Run the full suite, verify 170 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 170` (165 from Task 2 + 4 unit + 1 pipeline = 170), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/databasesConfigRule.ts src/validation/rules/databasesConfigRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add databasesConfigRule (document-scope)

Mirrors the connector's DatabasesConfig contract: exactly one of static
(non-empty array of database names) or discovery_query (non-empty SQL).
Provides faster in-editor feedback than the JSON schema's oneOf."
```

---

## Task 4: CHANGELOG + version bump 1.6.0 → 1.7.0

PR4 ships three new user-visible diagnostics, so version bumps minor.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Verify suite, build, lint, audit are clean**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 170`, `fail 0`.

```bash
npm run build 2>&1 | tail -3
```
Expected: clean (1 pre-existing webpack warning).

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
  "version": "1.6.0",
```

Replace with:
```json
  "version": "1.7.0",
```

- [ ] **Step 3: Prepend CHANGELOG entry** under the `# Change Log` header, before the existing `## [1.6.0]` section. Use today's date.

```markdown
## [1.7.0] - 2026-05-23

### Added

Three new document-scope validation rules that mirror static checks from `baton-sql/pkg/bsql/validate.go`:

- **`scope-enum`** — validates the `scope:` field on `list` / `entitlements` / `grants[]` is empty or `"cluster"`. Surfaces a `Did you mean 'cluster'?` suggestion for typos within Levenshtein distance 2 (e.g., `clustr`, `cluser`, `clustar`). Mirrors `validateScope`.
- **`random-password-constraints`** — validates each entry in `account_provisioning.credentials.random_password.constraints[]` has a non-empty `char_set` and `min_count > 0`. Mirrors `validatePasswordConstraints`.
- **`databases-config`** — validates `connect.databases` does not set both `static` and `discovery_query`. The JSON schema already enforces this via `oneOf`; the rule provides faster in-editor feedback.

### Behavior deltas

Users with these specific misconfigurations will now see diagnostics in the editor instead of discovering them at connector startup. Users with correct configs see no change.
```

- [ ] **Step 4: Verify tests still pass**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 170`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "release: bump to v1.7.0 — connector-mirror shape rules"
```

- [ ] **Step 6: Package**

```bash
rm -f baton-sql-extension-*.vsix && npm run package 2>&1 | tail -3
```

Expected: `baton-sql-extension-1.7.0.vsix`.

---

## Self-review checklist

- [ ] Three new rules: `scopeEnumRule`, `randomPasswordConstraintsRule`, `databasesConfigRule` — each `scope: 'document'`, each reading `ctx.document`.
- [ ] Each rule registered in `src/validation/rules/index.ts` (export + import + array entry).
- [ ] Each rule returns `ValidationResult[]` (can flag multiple).
- [ ] Each rule attempts to set `lineNumber`; falls back to `undefined` when not located.
- [ ] No existing rule files modified.
- [ ] No edits to `pipeline.ts`, `document.ts`, `parsedQuery.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`, `src/server/`.
- [ ] `npm test`: 170 passing.
- [ ] `npm run build`: clean.
- [ ] `npm run lint`: 0 errors.
- [ ] `npm audit`: clean.
- [ ] Version 1.7.0 + CHANGELOG entry.

## PR description template

```
PR4: Connector-mirror shape rules (v1.7.0)

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-23-pr4-connector-mirror-shape-rules.md

This is PR4 of 8 in the SQL validation foundation series. Adds three new
document-scope rules that mirror static checks from bsql/validate.go,
giving users in-editor feedback for misconfigurations that would otherwise
only surface at connector startup.

New rules (all scope: 'document'):
- scope-enum: scope: must be empty or 'cluster' (did-you-mean for typos)
- random-password-constraints: char_set non-empty, min_count > 0
- databases-config: not both static AND discovery_query

What's NOT changed:
- No existing rule files modified.
- No edits to pipeline.ts, document.ts, parsedQuery.ts, etc.
- No LSP feature provider, schema, snippets, or build config.

Tests: 154 → 170 (+16).
```
