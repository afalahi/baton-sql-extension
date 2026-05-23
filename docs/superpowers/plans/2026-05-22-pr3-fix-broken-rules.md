# PR3: Fix the Two Broken Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resurrect `batonParameterValidationRule` and `varsQueryMismatchRule` so they actually fire in production. Both rules currently look for `?<param>` patterns in their `sql` argument — but the production pipeline normalizes `?<param>` → `?` before invoking rules, so neither rule has ever matched in real configs. Fix: prefer `ctx.query.rawSql` (un-normalized) when ctx is available. Also: `varsQueryMismatchRule` adopts the connector's built-in vars (`limit`, `offset`, `cursor`) per `bsql/validate.go`, and prefers `ctx.query.varsScope` over scanning the raw YAML for a `vars:` block.

**Architecture:** Both rules gain a small `ctx?: RuleContext` parameter. Their bodies read `const rawSql = ctx?.query?.rawSql ?? sql;` (and `varsQueryMismatchRule` additionally reads `ctx?.query?.varsScope`). When ctx is undefined (direct unit-test calls), the existing fallback behavior is preserved exactly. When ctx is set (production pipeline + the `validateSql` shim), the rule sees the un-normalized SQL and the correctly-scoped vars map. Built-in vars are added to the "defined" side of the comparison so a query using `?<limit>` without a `limit:` entry in `vars:` is no longer flagged.

**Tech Stack:** TypeScript 4.x strict, `node:test` via `tsx`. No new runtime dependencies. Uses `String.prototype.matchAll` consistently for regex iteration.

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md` (Rollout, "PR3 — Fix the two broken rules"). The plan respects PR1's `ValidationRule.validate(sql, yamlContent, ctx?: RuleContext)` interface.

**Reference:** `baton-sql/pkg/bsql/validate.go:23-29` defines the built-in vars in `validateVarsInQuery`:
```go
for _, v := range usedVars {
    if _, ok := vars[v]; !ok {
        if v == limitKey || v == offsetKey || v == cursorKey {
            continue
        }
        return fmt.Errorf("query uses variable '%s' which is not defined in vars", v)
    }
}
```

**Behavior delta:** YES — this PR ships new diagnostics. Configs that today silently pass (e.g., `?<select>` as a param name, or `vars: { foo: x }` with the query using `?<bar>`) will start emitting errors. This is the intended user-visible improvement. Existing direct-call unit tests for these two rules continue to pass byte-identical because ctx-less calls preserve the old behavior.

**Diagnostic priority decision (varsQueryMismatchRule):** When BOTH "undefined" and "unused" apply, the rule reports **undefined first** in both modes. Rationale: undefined matches the connector's `validateVarsInQuery` (which raises an error) and is the more critical issue; unused is our UX guardrail. Unused is still reported when undefined is empty.

**Note on `validateSql` shim:** The shim builds a single-query BatonDocument with an empty `varsScope`. After PR3, `varsQueryMismatchRule` consumes that empty scope and would flag any `?<name>` as undefined when called via the shim. The existing 5 `sqlValidator.test.ts` tests don't include Baton params, so they're unaffected. External callers passing Baton params through `validateSql` (rare) would see a new diagnostic.

---

## File Structure

**Modified files:**
- `src/validation/rules/batonParameterValidationRule.ts` — accept `ctx?` and read `ctx.query.rawSql` when set
- `src/validation/rules/varsQueryMismatchRule.ts` — accept `ctx?`, read `ctx.query.rawSql` + `ctx.query.varsScope`, add limit/offset/cursor built-ins
- `src/validation/rules/batonParameterValidationRule.test.ts` — add 1 new test for the ctx-path
- `src/validation/rules/varsQueryMismatchRule.test.ts` — add 3 new tests: ctx.rawSql path (both directions), built-in vars accepted
- `src/validation/pipeline.test.ts` — add 3 smoke tests showing end-to-end production firing
- `CHANGELOG.md` — new `## [1.6.0]` section
- `package.json` — version bump `1.5.0` → `1.6.0`

**Not touched:**
- All other rule files in `src/validation/rules/` (the AST-consumption migration the PR2 final review flagged is a separate followup; this PR stays narrow per the spec).
- `src/validation/pipeline.ts`, `document.ts`, `parsedQuery.ts`, `dialect.ts`, `context.ts`, `types.ts`, `sqlValidator.ts`.
- `src/server/`, `schemas/`, `snippets/`.

**Tests after PR3:** 147 → 154 (+1 + 3 + 3).

---

## Task 1: `batonParameterValidationRule` consumes `ctx.query.rawSql`

**Files:**
- Modify: `src/validation/rules/batonParameterValidationRule.ts`
- Modify: `src/validation/rules/batonParameterValidationRule.test.ts`

The rule currently scans its `sql` parameter for `?<name>` patterns. In production through `validateDocument`, `sql` is `query.normalizedSql` (with `?<name>` replaced by `?`), so the rule never finds anything. After this task it reads `ctx.query.rawSql` when ctx is present and falls back to scanning `sql` when ctx is absent (preserves the existing direct-call unit tests).

- [ ] **Step 1: Append the failing test** to `src/validation/rules/batonParameterValidationRule.test.ts`:

```ts
import { parseQuery } from '../parsedQuery';
import type { BatonDocument } from '../document';

function emptyDoc(): BatonDocument {
  return {
    yaml: null,
    yamlContent: '',
    resourceTypes: new Map(),
    actions: new Map(),
    queries: [],
    definedEntitlementIds: { literal: new Set(), expression: new Set() },
    knownResourceTypeIds: new Set(),
  };
}

test('baton-parameter: when ctx is passed, the rule reads ctx.query.rawSql instead of normalized sql', () => {
  // Simulate the production pipeline: rules receive the NORMALIZED SQL as
  // their first arg, with the raw form available on ctx.query.rawSql. The
  // rule must look at rawSql, not the first arg.
  const rawSql = 'SELECT * FROM t WHERE x = ?<select>';
  const query = parseQuery({
    rawSql,
    yamlPath: [],
    startOffset: 0,
    endOffset: rawSql.length,
    varsScope: new Map(),
  });
  // query.normalizedSql replaces ?<select> with ? — that's what production
  // passes as the first arg.
  const r = batonParameterValidationRule.validate(query.normalizedSql, '', { query, document: emptyDoc() });
  assert.equal(r.isValid, false, 'should detect the SQL-keyword conflict via ctx.query.rawSql');
  assert.match(r.errorMessage || '', /SQL keyword/i);
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
node --import tsx --test src/validation/rules/batonParameterValidationRule.test.ts 2>&1 | tail -15
```

Expected: the new test fails because the rule currently scans `query.normalizedSql` (which has `?<select>` → `?`) and finds no Baton params.

- [ ] **Step 3: Update `src/validation/rules/batonParameterValidationRule.ts`** to read `ctx.query.rawSql` when available

Replace the entire file with:

```ts
import { ValidationRule, ValidationResult } from '../types';
import { findLineWithPattern, areWordsSimilar } from '../../utils/stringUtils';
import { RuleContext } from '../context';

export const batonParameterValidationRule: ValidationRule = {
  name: "baton-parameter-validation",
  description: "Validate Baton parameterized query syntax",
  validate: (sql: string, originalQuery: string, ctx?: RuleContext): ValidationResult => {
    // Prefer the un-normalized SQL via ctx (production path). Fall back to the
    // sql arg for direct-test calls where ctx is undefined.
    const rawSql = ctx?.query?.rawSql ?? sql;

    // Find all Baton parameters in the format ?<param_name>
    const batonParamRegex = /\?\<([^>]+)\>/g;
    const matches = [...rawSql.matchAll(batonParamRegex)];

    if (matches.length === 0) {
      return { isValid: true }; // No Baton parameters to validate
    }

    // SQL keywords that shouldn't be used as parameter names
    const sqlKeywords = new Set([
      'select', 'from', 'where', 'and', 'or', 'order', 'by', 'group', 'having',
      'join', 'inner', 'left', 'right', 'outer', 'on', 'as', 'in', 'exists',
      'not', 'between', 'like', 'null', 'is', 'limit', 'offset', 'insert',
      'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'alter',
      'drop', 'index', 'union', 'all', 'distinct', 'case', 'when', 'then',
      'else', 'end', 'with'
    ]);

    for (const match of matches) {
      const paramName = match[1].trim();
      const matchIndex = match.index || 0;

      // Check for empty parameter name
      if (!paramName) {
        return {
          isValid: false,
          errorMessage: "Empty Baton parameter name. Use format: ?<parameter_name>",
          position: matchIndex
        };
      }

      // Check for valid parameter name format (alphanumeric and underscores only)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName)) {
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Invalid Baton parameter name '${paramName}'. Use only letters, numbers, and underscores. Must start with letter or underscore.`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }

      // Check if parameter name conflicts with SQL keywords
      if (sqlKeywords.has(paramName.toLowerCase())) {
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Baton parameter name '${paramName}' conflicts with SQL keyword. Consider using '${paramName}_value' or '${paramName}_param'.`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }

      // Check for common naming convention issues
      if (paramName.length < 2) {
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Baton parameter name '${paramName}' is too short. Use descriptive names like 'user_id' or 'resource_name'.`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }

      // Check for potential typos in common parameter patterns
      const commonParams = ['user_id', 'resource_id', 'role_id', 'permission_id', 'group_id'];
      const similarParams = commonParams.filter(param =>
        areWordsSimilar(paramName.toLowerCase(), param, 1)
      );

      if (similarParams.length > 0 && !commonParams.includes(paramName.toLowerCase())) {
        const suggestion = similarParams[0];
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Possible typo in Baton parameter '${paramName}'. Did you mean '${suggestion}'?`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }
    }

    return { isValid: true };
  },
};
```

The ONLY change from the v1.5.0 file is:
1. Added `import { RuleContext } from '../context';`
2. Added third parameter `ctx?: RuleContext` to `validate`.
3. Added `const rawSql = ctx?.query?.rawSql ?? sql;` at the top of the body.
4. Changed `sql.matchAll(...)` to `rawSql.matchAll(...)` on the matches line.

- [ ] **Step 4: Update the file-level comment** in `src/validation/rules/batonParameterValidationRule.test.ts` so it no longer claims the rule effectively no-ops in production

Find the existing comment block (lines 5-8):

```ts
// Note: this rule's regex looks for `?<param>` in its `sql` argument. The production
// orchestrator (validateSql) normalizes those out before invoking rules, so in
// production this rule effectively no-ops. These tests exercise the rule's logic
// directly by passing un-normalized SQL.
```

Replace with:

```ts
// These tests exercise the rule's logic in two modes:
//   (1) Direct calls with raw SQL as both args — the legacy unit-test pattern
//       (rule.validate(rawSql, rawSql) without ctx). The rule falls back to
//       scanning its first argument for ?<name> patterns, which works because
//       the test input isn't normalized.
//   (2) With ctx, mirroring the production pipeline: the first arg is the
//       NORMALIZED SQL, ctx.query.rawSql carries the un-normalized form.
//       The rule must read ctx.query.rawSql.
// PR3 made the rule prefer ctx.query.rawSql so it fires correctly through
// validateDocument (which always passes ctx).
```

- [ ] **Step 5: Run the new test, verify it passes**

```bash
node --import tsx --test src/validation/rules/batonParameterValidationRule.test.ts 2>&1 | tail -15
```

Expected: `pass 6` (5 existing + 1 new), `fail 0`.

- [ ] **Step 6: Run the full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 148` (147 baseline + 1 new), `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/validation/rules/batonParameterValidationRule.ts src/validation/rules/batonParameterValidationRule.test.ts
git commit -m "validation: batonParameterValidationRule reads ctx.query.rawSql

Before this fix, the rule scanned its sql arg (the normalized SQL from the
pipeline) for ?<name> patterns and found nothing — every Baton param had
already been replaced with ?. After this fix, the rule prefers
ctx.query.rawSql, which is the un-normalized SQL with ?<name> intact.
Direct-call tests (rule.validate(rawSql, rawSql) without ctx) continue
to work via the fall-back path."
```

---

## Task 2: `varsQueryMismatchRule` consumes `ctx.query.rawSql` + `ctx.query.varsScope` + built-in vars

**Files:**
- Modify: `src/validation/rules/varsQueryMismatchRule.ts`
- Modify: `src/validation/rules/varsQueryMismatchRule.test.ts`

Same `?<name>` blindness as `batonParameterValidationRule`. Additionally, the existing `vars:` block detection scans the entire `originalQuery` (which in production is the WHOLE YAML, not just one resource type's section), so it incorrectly mixes vars from different sections. PR1's `ctx.query.varsScope` was specifically built to fix this — we now consume it. Finally, the connector treats `limit`/`offset`/`cursor` as automatically-available vars; we adopt the same convention.

- [ ] **Step 1: Append the failing tests** to `src/validation/rules/varsQueryMismatchRule.test.ts`:

```ts
import { parseQuery } from '../parsedQuery';
import type { BatonDocument } from '../document';

function emptyDoc(): BatonDocument {
  return {
    yaml: null,
    yamlContent: '',
    resourceTypes: new Map(),
    actions: new Map(),
    queries: [],
    definedEntitlementIds: { literal: new Set(), expression: new Set() },
    knownResourceTypeIds: new Set(),
  };
}

test('vars-query-mismatch: when ctx is passed, uses ctx.query.rawSql to find params', () => {
  // Construct a case where ?<user_id> appears in rawSql but the rule should
  // FLAG it because varsScope has different vars. Without reading rawSql,
  // the rule would see zero params (normalizedSql has ?, not ?<user_id>) and
  // wrongly return valid.
  const rawSql = 'SELECT * FROM users WHERE id = ?<user_id>';
  const query = parseQuery({
    rawSql,
    yamlPath: [],
    startOffset: 0,
    endOffset: rawSql.length,
    varsScope: new Map([['other_id', 'principal.ID']]),
  });
  const r = varsQueryMismatchRule.validate(query.normalizedSql, '', { query, document: emptyDoc() });
  assert.equal(r.isValid, false, 'should flag undefined param user_id from ctx.query.rawSql');
  assert.match(r.errorMessage || '', /not defined|user_id/i);
});

test('vars-query-mismatch: when ctx provides matching varsScope, no diagnostic', () => {
  const rawSql = 'SELECT * FROM users WHERE id = ?<user_id>';
  const query = parseQuery({
    rawSql,
    yamlPath: [],
    startOffset: 0,
    endOffset: rawSql.length,
    varsScope: new Map([['user_id', 'resource.ID']]),
  });
  const r = varsQueryMismatchRule.validate(query.normalizedSql, '', { query, document: emptyDoc() });
  assert.equal(r.isValid, true, 'vars match params via ctx -> valid');
});

test('vars-query-mismatch: limit / offset / cursor are built-in vars (no diagnostic)', () => {
  // Mirrors bsql/validate.go's validateVarsInQuery, which short-circuits
  // these three names. A query using ?<limit> with no `limit:` in vars must
  // NOT be flagged.
  for (const builtin of ['limit', 'offset', 'cursor']) {
    const rawSql = `SELECT * FROM users LIMIT ?<${builtin}>`;
    const query = parseQuery({
      rawSql,
      yamlPath: [],
      startOffset: 0,
      endOffset: rawSql.length,
      varsScope: new Map(),
    });
    const r = varsQueryMismatchRule.validate(query.normalizedSql, '', { query, document: emptyDoc() });
    assert.equal(r.isValid, true, `?<${builtin}> should be treated as a built-in`);
  }
});
```

- [ ] **Step 2: Run the tests, verify the negative-case test fails**

```bash
node --import tsx --test src/validation/rules/varsQueryMismatchRule.test.ts 2>&1 | tail -15
```

Expected: the first new test ("should flag undefined param user_id") fails because the rule currently doesn't read ctx.query.rawSql and sees zero params from normalizedSql. The second test happens to pass (zero params short-circuits to valid). The third (built-ins) also passes accidentally for the same reason.

- [ ] **Step 3: Replace `src/validation/rules/varsQueryMismatchRule.ts`** with the ctx-aware version

```ts
import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Built-in vars per baton-sql/pkg/bsql/validate.go:validateVarsInQuery.
 * Queries may use these without declaring them in the resource type's
 * `vars:` block.
 */
const BUILTIN_VARS = new Set(['limit', 'offset', 'cursor']);

/**
 * Validates that variables defined in `vars` are used in the query,
 * and that variables used in the query with ?<variable> syntax are defined
 * in `vars` (or are built-in pagination vars).
 *
 * The rule prefers ctx.query.usedParams + ctx.query.varsScope when ctx is
 * set (production pipeline path). Without ctx (direct unit-test calls), it
 * falls back to scanning the sql arg for ?<name> patterns via matchAll and
 * the originalQuery arg for a `vars:` block — preserving existing tests.
 */
export const varsQueryMismatchRule: ValidationRule = {
  name: "vars-query-mismatch",
  description: "Check for mismatches between vars definitions and query parameter usage",
  validate: (sql: string, originalQuery: string, ctx?: RuleContext): ValidationResult => {
    // --- Step 1: collect usedParameters ---
    const usedParameters = new Set<string>();
    if (ctx?.query) {
      // Production path: usedParams was computed from rawSql by parseQuery.
      for (const name of ctx.query.usedParams) {
        usedParameters.add(name);
      }
    } else {
      // Fallback path: scan sql arg directly via matchAll.
      const parameterPattern = /\?<(\w+)>/g;
      for (const match of sql.matchAll(parameterPattern)) {
        usedParameters.add(match[1]);
      }
    }

    // If no parameters are used, this rule doesn't apply.
    if (usedParameters.size === 0) {
      return { isValid: true };
    }

    // --- Step 2: collect definedVars ---
    const definedVars = new Set<string>();
    let varsLineNumber = -1;
    if (ctx?.query) {
      // Production path: use the resolved scope from the document walker.
      for (const name of ctx.query.varsScope.keys()) {
        definedVars.add(name);
      }
      // varsLineNumber is only meaningful for the YAML-scan fallback; when
      // using ctx we don't have a usable per-line index for the unused-vars
      // diagnostic, so we leave it as -1 (which suppresses that report).
    } else {
      // Fallback path: scan originalQuery for a `vars:` block.
      const lines = originalQuery.split('\n');
      let inVarsBlock = false;
      let varsBlockIndent = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === 'vars:') {
          inVarsBlock = true;
          varsLineNumber = i;
          varsBlockIndent = line.length - line.trimStart().length;
          continue;
        }

        if (inVarsBlock) {
          const currentIndent = line.length - line.trimStart().length;
          if (trimmed && currentIndent <= varsBlockIndent) {
            inVarsBlock = false;
            continue;
          }
          const varMatch = trimmed.match(/^(\w+):\s*.+/);
          if (varMatch) {
            definedVars.add(varMatch[1]);
          }
        }
      }
    }

    // --- Step 3: compute unused + undefined, excluding built-ins ---
    const unusedVars: string[] = [];
    for (const varName of definedVars) {
      if (BUILTIN_VARS.has(varName)) continue;
      if (!usedParameters.has(varName)) {
        unusedVars.push(varName);
      }
    }

    const undefinedVars: string[] = [];
    for (const paramName of usedParameters) {
      if (BUILTIN_VARS.has(paramName)) continue;
      if (!definedVars.has(paramName)) {
        undefinedVars.push(paramName);
      }
    }

    // --- Step 4: report ---
    // Priority: undefined first (matches connector's validateVarsInQuery, which
    // errors on undefined vars; the connector doesn't check unused at all —
    // that's our UX guardrail). Unused fires only when undefined is empty.

    if (undefinedVars.length > 0) {
      // Find the first line where the undefined variable is used. When ctx
      // is set we don't have a usable per-line index, so fall back to line 0.
      let errorLineNumber = 0;
      if (!ctx?.query) {
        const lines = originalQuery.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`?<${undefinedVars[0]}>`)) {
            errorLineNumber = i;
            break;
          }
        }
      }

      return {
        isValid: false,
        errorMessage: `Query uses parameter ?<${undefinedVars[0]}> but it's not defined in 'vars'. Add '${undefinedVars[0]}: <value>' to the vars block.`,
        lineNumber: errorLineNumber,
      };
    }

    if (unusedVars.length > 0) {
      // Emit in both modes. lineNumber is set only when we have a precise
      // YAML position (fallback mode); in ctx mode the diagnostic anchors
      // to the query span via the server's default range conversion.
      const result: ValidationResult = {
        isValid: false,
        errorMessage: `Variable(s) defined in 'vars' but not used in query: ${unusedVars.join(', ')}. Either use them in the query with ?<${unusedVars[0]}> or remove them from vars.`,
      };
      if (varsLineNumber !== -1) {
        result.lineNumber = varsLineNumber;
      }
      return result;
    }

    return { isValid: true };
  },
};
```

Notable changes from the v1.5.0 file:
1. Added `import { RuleContext } from '../context';` and `BUILTIN_VARS` constant.
2. `validate` gains `ctx?: RuleContext` parameter.
3. usedParameters collection forks on `ctx?.query`: uses `ctx.query.usedParams` (computed from rawSql by parseQuery in PR1) OR falls back to `sql.matchAll(...)`. The old while-loop pattern is replaced by `for ... of matchAll(...)` — semantically equivalent, more idiomatic.
4. definedVars collection forks on `ctx?.query`: uses `ctx.query.varsScope.keys()` OR falls back to YAML scanning.
5. Both the unused-vars and undefined-vars filters skip `BUILTIN_VARS`.

- [ ] **Step 4: Update the file-level comment** in `src/validation/rules/varsQueryMismatchRule.test.ts` so it no longer claims the rule no-ops in production

Find the existing comment block (lines 5-8):

```ts
// The rule scans its `sql` arg for `?<param>` patterns and its `originalQuery`
// arg for a vars: block. The production orchestrator normalizes `?<param>` out
// of the SQL before invoking rules, so this rule effectively no-ops there.
// These tests exercise the rule's logic directly.
```

Replace with:

```ts
// These tests cover both rule modes:
//   (1) Direct unit-test calls without ctx — the rule falls back to scanning
//       its sql arg for ?<name> patterns and originalQuery for a `vars:` block.
//       Several existing tests use this mode.
//   (2) Production-mode calls with ctx — the rule reads ctx.query.usedParams
//       (from rawSql) and ctx.query.varsScope, treating limit / offset /
//       cursor as built-in vars (matches bsql/validate.go).
// PR3 added mode (2) so the rule actually fires through validateDocument.
//
// Diagnostic priority: when BOTH "undefined" and "unused" apply, the rule
// reports undefined first. Test cases that exercise both conditions
// simultaneously expect the undefined diagnostic. The connector itself only
// errors on undefined; unused is purely our UX guardrail.
```

- [ ] **Step 5: Run the rule tests, verify all 7 pass**

```bash
node --import tsx --test src/validation/rules/varsQueryMismatchRule.test.ts 2>&1 | tail -15
```

Expected: `pass 7` (4 existing + 3 new), `fail 0`.

- [ ] **Step 6: Run the full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 151` (148 from Task 1 + 3 new), `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/validation/rules/varsQueryMismatchRule.ts src/validation/rules/varsQueryMismatchRule.test.ts
git commit -m "validation: varsQueryMismatchRule reads ctx.query.{usedParams,varsScope} + built-ins

Production path now uses ctx.query.usedParams (built from rawSql by the
document walker in PR1) and ctx.query.varsScope (correctly resolved per the
spec's resolution table). limit / offset / cursor are treated as built-in
vars matching bsql/validate.go's validateVarsInQuery. Fallback path
preserved for direct-call unit tests via String.matchAll iteration."
```

---

## Task 3: Pipeline smoke tests for end-to-end firing

**Files:**
- Modify: `src/validation/pipeline.test.ts`

The two rule-level tests above prove the ctx-path works. These pipeline tests prove the rules actually fire through `validateDocument` on realistic YAML configs.

- [ ] **Step 1: Append the smoke tests** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: batonParameterValidationRule fires for ?<select> via the full pipeline', () => {
  // Before PR3 this YAML produced zero diagnostics in production because
  // the rule was reading the normalized SQL. After PR3 the rule reads
  // ctx.query.rawSql and correctly flags the SQL-keyword conflict.
  const yaml = `
app_name: t
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT * FROM users WHERE x = ?<select>"
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r => /SQL keyword/i.test(r.result.errorMessage || ''));
  assert.ok(matching.length > 0, 'batonParameterValidationRule should fire in production');
});

test('pipeline: varsQueryMismatchRule fires for undefined param via the full pipeline', () => {
  // Resource type defines `vars: { team_id }` but the query uses ?<user_id>.
  // The pipeline must surface this through varsQueryMismatchRule.
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      vars:
        team_id: input.team_id
      query: "SELECT * FROM users WHERE id = ?<user_id>"
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /not defined|not used/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'varsQueryMismatchRule should fire in production');
});

test('pipeline: ?<limit> + ?<offset> are accepted without explicit vars (built-ins)', () => {
  // Paginated query using the built-in vars. Before PR3 this would have
  // produced no diagnostic anyway (because the rule was broken), but
  // critically it must NOT produce a "limit not defined" diagnostic
  // through the new ctx path.
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT * FROM users LIMIT ?<limit> OFFSET ?<offset>"
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const matching = results.filter(r =>
    /limit|offset/i.test(r.result.errorMessage || '') &&
    /not defined/i.test(r.result.errorMessage || '')
  );
  assert.equal(matching.length, 0, 'built-in vars (limit, offset) must not be flagged');
});
```

- [ ] **Step 2: Run pipeline tests, verify all pass**

```bash
node --import tsx --test src/validation/pipeline.test.ts 2>&1 | tail -15
```

Expected: 3 new tests pass + 13 prior = 16 in pipeline.test.ts.

- [ ] **Step 3: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 154` (151 from Task 2 + 3 new), `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/validation/pipeline.test.ts
git commit -m "validation: pipeline smoke tests for the two resurrected rules

Demonstrates that batonParameterValidationRule (?<select> SQL-keyword conflict)
and varsQueryMismatchRule (?<user_id> not in vars) now fire through the full
validateDocument path. Also locks in built-in var acceptance: ?<limit> +
?<offset> produce no diagnostic when used in a paginated query."
```

---

## Task 4: CHANGELOG + version bump 1.5.0 → 1.6.0

PR3 is a user-visible behavior change (two new diagnostics that didn't fire before), so it warrants a minor version bump.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Verify the suite, build, lint, audit are clean**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 154`, `fail 0`.

```bash
npm run build 2>&1 | tail -3
```
Expected: clean (1 pre-existing webpack warning).

```bash
npm run lint 2>&1 | tail -3
```
Expected: 0 errors, warnings similar to PR2's final state.

```bash
npm audit 2>&1 | tail -3
```
Expected: 0 vulnerabilities.

- [ ] **Step 2: Bump version in `package.json`**

Find:
```json
  "version": "1.5.0",
```

Replace with:
```json
  "version": "1.6.0",
```

- [ ] **Step 3: Prepend CHANGELOG entry**

Insert this section under the `# Change Log` header, before the existing `## [1.5.0]` section. The date should be today's date (`date '+%Y-%m-%d'`).

```markdown
## [1.6.0] - 2026-05-22

### Fixed

- **`batonParameterValidationRule` now fires in production.** The rule scans for `?<name>` patterns; previously it received the normalized SQL (with `?<name>` already replaced by `?`) and never matched. It now reads the un-normalized SQL via `ctx.query.rawSql`. Configs using a Baton param named after a SQL keyword (e.g., `?<select>`), with an invalid character (e.g., `?<user-id>`), or with a too-short name will now surface diagnostics.
- **`varsQueryMismatchRule` now fires in production** and uses the correctly-scoped `vars:` block from `ctx.query.varsScope` instead of scanning the entire YAML document. Configs whose query references a param not in the resource type's own `vars:` block now produce a diagnostic, and configs that define a `vars:` entry never referenced by the query do too.

### Added

- **Built-in vars `limit`, `offset`, `cursor`** are now treated as automatically defined by `varsQueryMismatchRule`, matching `baton-sql/pkg/bsql/validate.go`'s `validateVarsInQuery`. Paginated queries like `... LIMIT ?<limit> OFFSET ?<offset>` no longer need redundant `vars:` entries.

### Behavior deltas

Users will see two new categories of diagnostics on misconfigured YAML files. These were silently passing before PR3:
- "Baton parameter name '<name>' conflicts with SQL keyword" / "is too short" / contains invalid characters
- "Query uses parameter ?<name> but it's not defined in 'vars'" / "Variable(s) defined in 'vars' but not used in query"

Users with correct configs see no change.
```

- [ ] **Step 4: Verify tests still pass**

```bash
npm test 2>&1 | tail -6
```
Expected: `pass 154`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "release: bump to v1.6.0 — resurrect the two broken validation rules"
```

- [ ] **Step 6: Package**

```bash
rm -f baton-sql-extension-*.vsix && npm run package 2>&1 | tail -3
```

Expected: clean package at ~1.6 MB, `baton-sql-extension-1.6.0.vsix`.

---

## Self-review checklist (engineer runs this before opening the PR)

- [ ] `src/validation/rules/batonParameterValidationRule.ts` imports `RuleContext` from `'../context'`, signature now has optional `ctx?`, body uses `ctx?.query?.rawSql ?? sql`.
- [ ] `src/validation/rules/varsQueryMismatchRule.ts` imports `RuleContext`, signature has optional `ctx?`, body uses `ctx?.query?.usedParams` + `ctx?.query?.varsScope` when ctx is set, falls back to YAML scanning otherwise. Built-in vars constant `BUILTIN_VARS = new Set(['limit', 'offset', 'cursor'])` excludes them from both unused and undefined checks. Uses `String.matchAll` iteration (no while-loop with regex.exec).
- [ ] Existing 9 tests across the two rule-test files (5 + 4) still pass — only the file-level comments are edited.
- [ ] 4 new tests across the two rule-test files (1 + 3) pass.
- [ ] 3 new pipeline smoke tests pass.
- [ ] `npm test` reports 154 passing.
- [ ] `npm run build` clean.
- [ ] `npm run lint` has 0 errors.
- [ ] `npm audit` clean.
- [ ] Version is 1.6.0; CHANGELOG has the 1.6.0 entry.
- [ ] No other rule files in `src/validation/rules/` were touched.
- [ ] No edits to `src/server/`, `pipeline.ts`, `document.ts`, `parsedQuery.ts`, `dialect.ts`, `sqlValidator.ts`, `types.ts`, `context.ts`.

## PR description template

```
PR3: Fix the two broken validation rules

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-22-pr3-fix-broken-rules.md

This is PR3 of 8 in the SQL validation foundation series. Two rules
(batonParameterValidationRule, varsQueryMismatchRule) have been silently
no-op'ing in production since they were written, because the production
pipeline normalizes ?<name> → ? before invoking rules and the rules looked
for ?<name> in their first arg.

What's added:
- Both rules accept an optional ctx parameter and prefer ctx.query.rawSql
  (un-normalized SQL via the un-normalized path) plus ctx.query.varsScope
  (resolved per-query vars).
- BUILTIN_VARS = {limit, offset, cursor} per bsql/validate.go.

What's modified:
- src/validation/rules/batonParameterValidationRule.ts
- src/validation/rules/varsQueryMismatchRule.ts
- File-level comments in the two test files updated.

Behavior deltas:
- New diagnostics for malformed Baton param names (SQL keyword, invalid
  chars, too short).
- New diagnostics for vars/?<param> mismatches.
- limit / offset / cursor accepted without explicit vars: entries.

What's NOT changed:
- No other rule file. The AST-consumption migration the PR2 reviewer
  flagged (rules calling getParser().astify() directly instead of
  reading ctx.query.ast) is a separate followup.
- No LSP feature provider, schema, snippet, or build-config edits.

Tests: 147 → 154 (+7).
```
