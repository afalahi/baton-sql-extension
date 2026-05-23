# PR5: Action Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two document-scope validation rules that mirror static action-validation checks from `baton-sql/pkg/bsql/validate.go`. Users get fast in-editor feedback for misshapen `actions` blocks instead of confusing schema errors (or worse, runtime errors at connector startup).

**Architecture:** Two new rules, both `scope: 'document'`. (1) `actionQueryShapeRule` mirrors `ActionConfig.oneOf` from the schema — an action must specify exactly one of `query` (string) or `queries` (array). (2) `actionArgumentDefaultRule` enforces the `ArgumentConfig.default` description rule: `default` must not be set when `required: true`. Both consume `ctx.document.actions`, walk every action, and emit one diagnostic per violation with a `lineNumber` anchored via a YAML line scan.

**Tech Stack:** TypeScript 4.x strict, `node:test` via `tsx`. Document-scope rule infrastructure landed in PR1; first three doc-scope rules landed in PR4 (`scopeEnumRule`, `randomPasswordConstraintsRule`, `databasesConfigRule`). Each new rule returns `ValidationResult[]` since one config can have multiple offending actions/arguments.

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md` rollout row "PR5 — Action validation: `ActionConfig` `query` ⊕ `queries`, `ArgumentConfig` `required: true` conflicts with `default`. Document-scoped. ~100 LOC. New error categories."

**Reference — what we're mirroring:**

From `schemas/baton-schema.json` (already enforced structurally by Red Hat YAML; rules give clearer messages):

```json
"ActionConfig": {
  "oneOf": [
    { "required": ["query"], "not": { "required": ["queries"] } },
    { "required": ["queries"], "not": { "required": ["query"] } }
  ]
},
"ArgumentConfig": {
  "default": {
    "description": "Default value when not provided. Must not be set when `required` is true."
  }
}
```

The `ArgumentConfig` description note is informational only — the schema does NOT structurally enforce it. PR5 promotes it to a real check.

**Behavior delta:** YES — new diagnostics. Action configs with both `query` and `queries`, with neither, or with required arguments that also have defaults, now produce errors that didn't fire before (or fired only as cryptic schema messages from the Red Hat YAML extension).

---

## File Structure

**New files:**
- `src/validation/rules/actionQueryShapeRule.ts`
- `src/validation/rules/actionQueryShapeRule.test.ts`
- `src/validation/rules/actionArgumentDefaultRule.ts`
- `src/validation/rules/actionArgumentDefaultRule.test.ts`

**Modified files:**
- `src/validation/rules/index.ts` — export + import + array entry for each of the 2 new rules
- `src/validation/pipeline.test.ts` — append smoke tests for each new rule
- `CHANGELOG.md`
- `package.json` (version 1.7.0 → 1.8.0)

**Not touched:**
- Any of the 17 existing rule files
- `src/validation/document.ts`, `parsedQuery.ts`, `pipeline.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`
- `src/server/`, `schemas/`, `snippets/`

**Tests after PR5:** 170 → 182 (Task 1: +6, Task 2: +6).

---

## Task 1: `actionQueryShapeRule`

**Files:**
- Create: `src/validation/rules/actionQueryShapeRule.ts`
- Create: `src/validation/rules/actionQueryShapeRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

An action must specify exactly one of `query` (single SQL string) or `queries` (array of SQL strings). The BatonDocument walker (in `src/validation/document.ts:425-453`) populates:
- `actionDef.query: ParsedQuery | undefined` — set only when YAML had a non-empty `query` string.
- `actionDef.queries: ParsedQuery[] | undefined` — set to `[]` or populated when YAML had a `queries` array, undefined otherwise.

The rule fires for two violations:
1. **Both set:** `actionDef.query != null` AND `actionDef.queries` is a non-empty array.
2. **Neither set:** `actionDef.query == null` AND (`actionDef.queries` is undefined OR is an empty array).

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/actionQueryShapeRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionQueryShapeRule } from './actionQueryShapeRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = actionQueryShapeRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const ACTION_BASE = `
app_name: test
connect:
  dsn: postgres://x
resource_types: {}
`;

test('action-query-shape: only query is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('action-query-shape: only queries (array) is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    queries:
      - "UPDATE users SET disabled = true WHERE id = ?<user_id>"
      - "INSERT INTO audit (action) VALUES ('disable')"
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('action-query-shape: both query AND queries is rejected', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    queries:
      - "INSERT INTO audit (action) VALUES ('disable')"
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /disable_user/);
  assert.match(results[0].errorMessage || '', /exactly one|both/i);
});

test('action-query-shape: neither query nor queries is rejected', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /disable_user/);
  assert.match(results[0].errorMessage || '', /must specify|query.*queries/i);
});

test('action-query-shape: multiple actions, each checked independently', () => {
  const yaml = ACTION_BASE + `
actions:
  good_action:
    name: Good
    query: "UPDATE x SET y = 1"
  both_set:
    name: Both
    query: "UPDATE x SET y = 1"
    queries:
      - "UPDATE z SET w = 1"
  neither_set:
    name: Neither
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
  const messages = results.map(r => r.errorMessage || '');
  assert.ok(messages.some(m => /both_set/.test(m)));
  assert.ok(messages.some(m => /neither_set/.test(m)));
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/rules/actionQueryShapeRule.test.ts 2>&1 | tail -15
```

Expected: cannot find module `./actionQueryShapeRule`.

- [ ] **Step 3: Implement `src/validation/rules/actionQueryShapeRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates each ActionConfig has exactly one of `query` (single SQL string)
 * or `queries` (array of SQL strings). Mirrors the schema's oneOf constraint
 * but provides a clearer message than Red Hat YAML's schema error output.
 */
export const actionQueryShapeRule: ValidationRule = {
  name: 'action-query-shape',
  description: "Validate each action has exactly one of 'query' or 'queries'",
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [actionId, action] of doc.actions) {
      const hasQuery = action.query != null;
      const hasQueries = Array.isArray(action.queries) && action.queries.length > 0;

      if (hasQuery && hasQueries) {
        results.push({
          isValid: false,
          errorMessage: `actions.${actionId}: must specify exactly one of 'query' or 'queries', not both.`,
          lineNumber: findActionLineNumber(yamlContent, actionId),
        });
      } else if (!hasQuery && !hasQueries) {
        results.push({
          isValid: false,
          errorMessage: `actions.${actionId}: must specify either 'query' or 'queries'.`,
          lineNumber: findActionLineNumber(yamlContent, actionId),
        });
      }
    }

    return results;
  },
};

/**
 * Locate the line containing `<actionId>:` as a direct child of `actions:`.
 * Tracks the indent of the first child to avoid false-matching nested keys
 * that happen to share the action ID. Returns undefined when not found;
 * diagnostic falls back to the default range.
 */
function findActionLineNumber(yamlContent: string, actionId: string): number | undefined {
  const lines = yamlContent.split('\n');
  let inActions = false;
  let actionsIndent = -1;
  let childIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const indent = line.length - line.trimStart().length;

    if (trimmed === 'actions:') {
      inActions = true;
      actionsIndent = indent;
      childIndent = -1;
      continue;
    }
    if (!inActions) continue;

    // Leaving the actions block when indent returns to actions level or above.
    if (indent <= actionsIndent) {
      inActions = false;
      continue;
    }

    // Lock to the first child indent. Only match action keys at exactly that level.
    if (childIndent < 0) childIndent = indent;
    if (indent !== childIndent) continue;

    if (trimmed.startsWith(actionId)) {
      const after = trimmed.slice(actionId.length);
      if (after === ':' || after.startsWith(': ')) {
        return i;
      }
    }
  }

  return undefined;
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export (with the other rule exports):

```ts
export { actionQueryShapeRule } from './actionQueryShapeRule';
```

Add the import (with the other rule imports):

```ts
import { actionQueryShapeRule } from './actionQueryShapeRule';
```

Append to the `allValidationRules` array (after `databasesConfigRule`):

```ts
  actionQueryShapeRule,
```

- [ ] **Step 5: Run unit tests, verify all 5 pass**

```bash
node --import tsx --test src/validation/rules/actionQueryShapeRule.test.ts 2>&1 | tail -15
```

Expected: `pass 5`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: actionQueryShapeRule fires when both query and queries are set', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types: {}
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    queries:
      - "INSERT INTO audit (action) VALUES ('disable')"
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /actions\.disable_user/.test(r.result.errorMessage || '') &&
    /exactly one|both/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'actionQueryShapeRule should fire when both query and queries are set');
});
```

- [ ] **Step 7: Run the full suite, verify 176 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 176` (170 baseline + 5 unit + 1 pipeline = 176), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/actionQueryShapeRule.ts src/validation/rules/actionQueryShapeRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add actionQueryShapeRule (document-scope)

Mirrors ActionConfig.oneOf from the schema: each action must specify exactly
one of 'query' (single SQL) or 'queries' (array of SQL). Fires for both the
'both set' and 'neither set' cases. Provides clearer messages than the
Red Hat YAML extension's schema-error output."
```

---

## Task 2: `actionArgumentDefaultRule`

**Files:**
- Create: `src/validation/rules/actionArgumentDefaultRule.ts`
- Create: `src/validation/rules/actionArgumentDefaultRule.test.ts`
- Modify: `src/validation/rules/index.ts`
- Modify: `src/validation/pipeline.test.ts`

Each action argument is `{ name, type, required?, default?, description?, placeholder? }`. The schema's `ArgumentConfig.default` description says: "Must not be set when `required` is true." The schema does NOT structurally enforce this. PR5 promotes it to a real check.

Rule: flag every argument where `arg.required === true` AND `arg.default !== undefined`. The `!== undefined` check is intentional — `default: ""`, `default: null`, `default: 0`, `default: false` are all explicit settings and still conflict with `required: true`.

`ctx.document.actions.get(id).arguments` is `Record<string, any> | undefined` (the walker assigns it directly from YAML without strong typing).

- [ ] **Step 1: Write the failing tests** in `src/validation/rules/actionArgumentDefaultRule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionArgumentDefaultRule } from './actionArgumentDefaultRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = actionArgumentDefaultRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const ACTION_BASE = `
app_name: test
connect:
  dsn: postgres://x
resource_types: {}
`;

test('arg-required-default: required=true with no default is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
        required: true
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('arg-required-default: default set with required=false is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      reason:
        name: Reason
        type: string
        required: false
        default: "no reason given"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('arg-required-default: default set with required omitted is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      reason:
        name: Reason
        type: string
        default: "no reason given"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('arg-required-default: required=true with default is rejected', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
        required: true
        default: "anonymous"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /user_id/);
  assert.match(results[0].errorMessage || '', /required.*default|default.*required/i);
});

test('arg-required-default: multiple offending args produce multiple diagnostics', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
        required: true
        default: "anonymous"
      reason:
        name: Reason
        type: string
        required: true
        default: "no reason"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/rules/actionArgumentDefaultRule.test.ts 2>&1 | tail -15
```

Expected: cannot find module.

- [ ] **Step 3: Implement `src/validation/rules/actionArgumentDefaultRule.ts`**

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates that an action argument with `required: true` does not also
 * specify a `default` value. The two are semantically contradictory — if the
 * user must provide a value, a default is meaningless. The schema's
 * ArgumentConfig.default description notes this constraint but does not
 * structurally enforce it; this rule promotes it to a real check.
 */
export const actionArgumentDefaultRule: ValidationRule = {
  name: 'arg-required-default',
  description: "Validate action arguments don't combine required: true with default",
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [actionId, action] of doc.actions) {
      const args = action.arguments;
      if (!args || typeof args !== 'object') continue;

      for (const [argName, arg] of Object.entries(args)) {
        if (!arg || typeof arg !== 'object') continue;
        const required = (arg as Record<string, unknown>).required;
        const defaultValue = (arg as Record<string, unknown>).default;

        if (required === true && defaultValue !== undefined) {
          results.push({
            isValid: false,
            errorMessage: `actions.${actionId}.arguments.${argName}: 'default' must not be set when 'required' is true.`,
            lineNumber: findArgDefaultLineNumber(yamlContent, actionId, argName),
          });
        }
      }
    }

    return results;
  },
};

/**
 * Best-effort line anchor: locate the `default:` key under the named argument
 * inside the named action. State machine tracks indent levels so it correctly
 * exits the action / arguments / arg block when indent drops, instead of
 * leaking into later siblings that happen to share an arg name. Falls back to
 * the argument name line if `default:` is not on its own line.
 */
function findArgDefaultLineNumber(
  yamlContent: string,
  actionId: string,
  argName: string
): number | undefined {
  const lines = yamlContent.split('\n');
  let actionsIndent = -1;
  let actionIndent = -1;
  let argsIndent = -1;
  let argIndent = -1;
  let inActions = false;
  let inAction = false;
  let inArguments = false;
  let inArg = false;
  let argLine = -1;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const indent = line.length - line.trimStart().length;

    // Exit nested blocks when indent drops back to or above their parent level.
    if (inArg && indent <= argIndent) {
      inArg = false;
    }
    if (inArguments && indent <= argsIndent) {
      inArguments = false;
      inArg = false;
    }
    if (inAction && indent <= actionIndent) {
      inAction = false;
      inArguments = false;
      inArg = false;
    }
    if (inActions && indent <= actionsIndent && trimmed !== 'actions:') {
      inActions = false;
      inAction = false;
      inArguments = false;
      inArg = false;
    }

    if (trimmed === 'actions:') {
      inActions = true;
      actionsIndent = indent;
      continue;
    }
    if (!inActions) continue;

    if (!inAction && matchesKey(trimmed, actionId)) {
      inAction = true;
      actionIndent = indent;
      continue;
    }
    if (!inAction) continue;

    if (!inArguments && trimmed === 'arguments:') {
      inArguments = true;
      argsIndent = indent;
      continue;
    }
    if (!inArguments) continue;

    if (!inArg && matchesKey(trimmed, argName)) {
      inArg = true;
      argIndent = indent;
      argLine = i;
      continue;
    }
    if (!inArg) continue;

    if (trimmed.startsWith('default:')) {
      return i;
    }
  }

  return argLine >= 0 ? argLine : undefined;
}

function matchesKey(trimmed: string, key: string): boolean {
  if (!trimmed.startsWith(key)) return false;
  const after = trimmed.slice(key.length);
  return after === ':' || after.startsWith(': ');
}
```

- [ ] **Step 4: Register the rule** in `src/validation/rules/index.ts`

Add the export:

```ts
export { actionArgumentDefaultRule } from './actionArgumentDefaultRule';
```

Add the import:

```ts
import { actionArgumentDefaultRule } from './actionArgumentDefaultRule';
```

Append to `allValidationRules` (after `actionQueryShapeRule`):

```ts
  actionArgumentDefaultRule,
```

- [ ] **Step 5: Run unit tests, verify all 5 pass**

```bash
node --import tsx --test src/validation/rules/actionArgumentDefaultRule.test.ts 2>&1 | tail -15
```

Expected: `pass 5`, `fail 0`.

- [ ] **Step 6: Append a pipeline smoke test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: actionArgumentDefaultRule fires when required=true and default is set', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types: {}
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
        required: true
        default: "anonymous"
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /arguments\.user_id/.test(r.result.errorMessage || '') &&
    /required|default/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'actionArgumentDefaultRule should fire when required=true and default is set');
});
```

- [ ] **Step 7: Run the full suite, verify 182 pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 182` (176 from Task 1 + 5 unit + 1 pipeline = 182), `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/validation/rules/actionArgumentDefaultRule.ts src/validation/rules/actionArgumentDefaultRule.test.ts src/validation/rules/index.ts src/validation/pipeline.test.ts
git commit -m "validation: add actionArgumentDefaultRule (document-scope)

Flags action arguments that combine 'required: true' with a 'default' value.
The schema's ArgumentConfig.default description notes this constraint but
doesn't enforce it; this rule promotes it to a real check."
```

---

## Task 3: CHANGELOG + version bump 1.7.0 → 1.8.0

PR5 ships two new user-visible diagnostics; minor version bump.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Verify suite, build, lint, audit are clean**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 182`, `fail 0`.

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

If any check fails, REPORT BACK with BLOCKED status — do NOT proceed.

- [ ] **Step 2: Bump version in `package.json`**

Find:
```json
  "version": "1.7.0",
```

Replace with:
```json
  "version": "1.8.0",
```

- [ ] **Step 3: Prepend CHANGELOG entry** under the `# Change Log` header, before the existing `## [1.7.0]` section. Use today's date.

```markdown
## [1.8.0] - 2026-05-23

### Added

Two new document-scope validation rules covering action configuration:

- **`action-query-shape`** — validates each action under `actions:` specifies exactly one of `query` (single SQL string) or `queries` (array). Fires for both the "both set" and "neither set" cases. Mirrors `ActionConfig.oneOf` from the schema with clearer error messages than the Red Hat YAML extension's schema output.
- **`arg-required-default`** — validates that an action argument with `required: true` does not also specify a `default` value. The two are semantically contradictory. The schema's `ArgumentConfig.default` description notes this constraint but doesn't enforce it structurally; this rule promotes it to a real check.

### Behavior deltas

Users whose `actions:` blocks combine `query` + `queries`, omit both, or set both `required: true` and `default` on the same argument will now see in-editor diagnostics. Users with correct configs see no change.
```

- [ ] **Step 4: Verify tests still pass**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 182`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "release: bump to v1.8.0 — action validation rules"
```

- [ ] **Step 6: Package**

```bash
rm -f baton-sql-extension-*.vsix && npm run package 2>&1 | tail -3
```

Expected: `baton-sql-extension-1.8.0.vsix`.

---

## Self-review checklist

- [ ] Two new rules: `actionQueryShapeRule`, `actionArgumentDefaultRule` — both `scope: 'document'`, both reading `ctx.document.actions`.
- [ ] Each rule registered in `src/validation/rules/index.ts` (export + import + array entry).
- [ ] Each rule returns `ValidationResult[]`.
- [ ] Each rule attempts to set `lineNumber`; falls back to `undefined` when not located.
- [ ] No existing rule files modified.
- [ ] No edits to `pipeline.ts`, `document.ts`, `parsedQuery.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`, `src/server/`.
- [ ] `npm test`: 182 passing.
- [ ] `npm run build`: clean.
- [ ] `npm run lint`: 0 errors.
- [ ] `npm audit`: clean.
- [ ] Version 1.8.0 + CHANGELOG entry.

## PR description template

```
PR5: Action validation (v1.8.0)

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-23-pr5-action-validation.md

PR5 of 8 in the SQL validation foundation series. Adds two new document-scope
rules covering action configuration.

New rules (both scope: 'document'):
- action-query-shape: actions must specify exactly one of query/queries
- arg-required-default: required: true conflicts with default

What's NOT changed:
- No existing rule files modified.
- No edits to pipeline.ts, document.ts, parsedQuery.ts, etc.
- No LSP feature provider, schema, snippets, or build config.

Tests: 170 → 182 (+12).
```
