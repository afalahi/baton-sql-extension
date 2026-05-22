# SQL Validation Foundation — Design

**Status:** Approved (brainstorming complete; PR1 implementation plan to follow)
**Date:** 2026-05-22
**Scope:** A staged refactor of `src/validation/` that introduces a shared parsed-document model so existing rules become more precise and new categories of rules (connector-aware, cross-query) become easy to add. The implementation plan that follows this design covers **PR1 (the foundation) only**; PR2-PR8 are sketched here for context and each will get its own plan when picked up.

## Context

The current validation pipeline (`src/validation/sqlValidator.ts`) calls each rule with `(sql, originalQuery)` — where `originalQuery` is actually the full YAML document content, not the SQL. Most rules then re-parse the same SQL with `node-sql-parser` (or fall back to ad-hoc regex/string scanning), and rules cannot see anything outside the single query they're handed. This causes three classes of problem:

1. **Brittleness.** Many rules carry both AST and string-fallback code paths because the default `node-sql-parser` dialect rejects valid postgres/mysql syntax. Fallbacks miss things the AST would catch and vice versa.
2. **Broken rules in production.** `validateSql` normalizes `?<param>` → `?` before invoking rules, so `batonParameterValidationRule` and `varsQueryMismatchRule` — both of which look for `?<param>` in the `sql` argument — never fire on real configs.
3. **No cross-query visibility.** We can't catch high-value bugs like a `grants[].map.entitlement_id` referencing an undefined entitlement, or a `traits.user.login` pointing at a column the `list.query` never SELECTs.

## Goals

- Make every existing rule's underlying detection more precise without changing any user-visible behavior in the foundation PR.
- Enable a new category of rules: connector-aware (mirroring `baton-sql/pkg/bsql/validate.go`) and cross-query (document-scoped).
- Keep the public LSP wire format identical: same `Diagnostic` shape, same hover, same code actions.
- Preserve the 75-test regression suite as the safety net; foundation PR ships only when all 75 pass unchanged.

## Non-goals

- No replacement of `node-sql-parser` with a different SQL parser.
- No adoption of an external linter (sqlfluff etc.) — kept in scope intentionally for ownership.
- No dialect-aware parsing in PR1 — that ships as PR2 because it changes which code paths run for dialect-specific SQL and therefore changes diagnostics.
- No changes to `src/server/features/*` (hover, completion, code actions, go-to-def).
- No changes to the JSON schema or snippets.
- No new diagnostic messages in PR1 — those land in PR3+.

## Architecture

### File layout

PR1 adds three new files under `src/validation/`:

```
src/validation/
  document.ts      // BatonDocument, ConnectConfig, ResourceTypeDef, ActionDef, buildBatonDocument()
  parsedQuery.ts   // ParsedQuery, parseQuery(rawSql, varsScope, yamlPath, offsets)
  context.ts       // RuleContext (re-exports for rule files)
  sqlValidator.ts  // rewritten body, same external signature
  types.ts         // extended with the new optional ctx parameter on ValidationRule
```

`document.ts` depends on `parsedQuery.ts`. Nothing in `src/server/features/` is touched.

### New types

```ts
// document.ts

interface ConnectConfig {
  dsn?: string;
  scheme?: string;          // 'postgres' | 'mysql' | 'sqlserver' | 'oracle' | 'hdb' | string
  host?: string; port?: string; database?: string;
  user?: string; password?: string;
  params?: Record<string, string>;
  databases?: { static?: string[]; discovery_query?: string };
}

interface ResourceTypeDef {
  id: string;               // map key (e.g. 'user')
  name?: string;            // 'name' field in YAML
  description?: string;
  list?: { vars: Map<string,string>; query: ParsedQuery | null; map?: any; pagination?: any; scope?: string };
  entitlements?: { vars: Map<string,string>; query: ParsedQuery | null; map?: any; pagination?: any; scope?: string };
  grants: Array<{ vars: Map<string,string>; query: ParsedQuery | null; map?: any; pagination?: any; scope?: string }>;
  staticEntitlements: Array<{ id: string; provisioning?: { vars: Map<string,string>; grant?: any; revoke?: any } }>;
  accountProvisioning?: any;   // structural only — PR3 introduces the rules that read this
  credentialRotation?: any;    // ditto
}

interface ActionDef {
  id: string;               // map key
  name?: string;
  arguments?: Record<string, any>;
  vars?: Map<string,string>;
  query?: ParsedQuery | null;
  queries?: ParsedQuery[];
}

interface BatonDocument {
  yaml: any | null;           // js-yaml result, or null when parse failed (degraded doc)
  yamlContent: string;
  connect?: ConnectConfig;
  resourceTypes: Map<string, ResourceTypeDef>;
  actions: Map<string, ActionDef>;
  queries: ParsedQuery[];     // flat list across resource types + actions
  definedEntitlementIds: {
    literal: Set<string>;     // from static_entitlements[].id (literal strings)
    expression: Set<string>;  // from entitlements.map[].id (CEL expressions; raw text)
  };
  knownResourceTypeIds: Set<string>;   // resource_types map keys
}
```

```ts
// parsedQuery.ts

interface ParsedQuery {
  rawSql: string;              // ?<param> intact
  normalizedSql: string;       // ?<param> → ?
  ast: any | null;             // null on parse failure
  astError: string | null;
  yamlPath: (string | number)[];   // strings for keys, numbers for array indices
  startOffset: number;         // absolute byte offset in BatonDocument.yamlContent
  endOffset: number;
  varsScope: Map<string,string>;   // vars visible to this query (see scope-resolution table)
  usedParams: Set<string>;     // ?<param> names found in rawSql
}
```

```ts
// context.ts

interface RuleContext {
  query?: ParsedQuery;         // present for scope:'query' rules; undefined for scope:'document'
  document: BatonDocument;
}
```

**Note on PR1 dialect:** `ParsedQuery` does **not** carry a `dialect` field in PR1. SQL is parsed with the default `node-sql-parser` dialect, matching today's behavior exactly. PR2 introduces the dialect field and the `connect.scheme` → parser-dialect mapping.

**Note on `RuleContext.query` narrowing.** Query-scoped rule authors will need `if (!ctx?.query) return { isValid: true };` to satisfy TypeScript. PR1 ships with this boilerplate documented in the rule-authoring section of CLAUDE.md. A cleaner approach (two context shapes) is deferred — not worth the API churn until we have ~3 document-scoped rules to justify it.

### `buildBatonDocument`

```ts
function buildBatonDocument(yamlContent: string): BatonDocument
```

Pure function. Steps:

1. Parse YAML via existing `parseYaml(yamlContent)`. On parse failure, return a **degraded BatonDocument**: `{ yaml: null, yamlContent, resourceTypes: Map(), actions: Map(), queries: [], definedEntitlementIds: {literal: Set(), expression: Set()}, knownResourceTypeIds: Set() }`. This preserves today's silent-skip behavior when the user is mid-edit.
2. Walk the YAML object to build `resourceTypes` and `actions` maps.
3. For each SQL query located in the walk (using the existing `findSQLQueries` for offsets), construct a `ParsedQuery` by calling `parseQuery(rawSql, varsScope, yamlPath, offsets)`.
4. `parseQuery` computes: `normalizedSql` via existing `normalizeSQL`; AST via `getParser().astify(normalizedSql)` (default dialect for PR1); `usedParams` via regex scan of `rawSql`; assembles the `ParsedQuery` object.
5. Aggregate `definedEntitlementIds`: iterate every `staticEntitlements[].id` into `.literal`, every `entitlements.map[].id` raw expression string into `.expression`.
6. Aggregate `knownResourceTypeIds` as the key-set of `resourceTypes`.
7. Return the assembled `BatonDocument`.

### `varsScope` resolution

Each query's `varsScope` is the merge of `vars` blocks from its container scopes, with inner scopes overriding outer. The mapping by yamlPath:

| Query yamlPath | varsScope source(s) (closer overrides farther) |
|---|---|
| `resource_types.<rt>.list.query` | `resource_types.<rt>.list.vars` |
| `resource_types.<rt>.entitlements.query` | `resource_types.<rt>.entitlements.vars` |
| `resource_types.<rt>.grants[<i>].query` | `resource_types.<rt>.grants[<i>].vars` |
| `resource_types.<rt>.static_entitlements[<i>].provisioning.grant.queries[<j>]` | `resource_types.<rt>.static_entitlements[<i>].provisioning.vars` |
| `resource_types.<rt>.static_entitlements[<i>].provisioning.revoke.queries[<j>]` | same as grant |
| `resource_types.<rt>.entitlements.map[<i>].provisioning.grant.queries[<j>]` | `resource_types.<rt>.entitlements.map[<i>].provisioning.vars` |
| `resource_types.<rt>.entitlements.map[<i>].provisioning.revoke.queries[<j>]` | same |
| `resource_types.<rt>.account_provisioning.create.queries[<j>]` | `resource_types.<rt>.account_provisioning.create.vars` |
| `resource_types.<rt>.account_provisioning.validate.query` | `resource_types.<rt>.account_provisioning.validate.vars` |
| `resource_types.<rt>.credential_rotation.update.queries[<j>]` | `resource_types.<rt>.credential_rotation.update.vars` |
| `actions.<a>.query` | `actions.<a>.vars` plus `actions.<a>.arguments` keys |
| `actions.<a>.queries[<j>]` | same |

PR1 ships a `resolveVarsScope(yamlObject, yamlPath)` helper covering exactly these cases. PR3+ (`vars`/`?<param>` rule) treats `limit`, `offset`, `cursor` as additional built-ins per `bsql/validate.go`.

### Data flow

```
LSP onDidChange(doc)
        │
        ▼
hash := hashString(doc.text)
        │
        ▼
documentCache.get(hash)? ─yes─► sendDiagnostics(cached); return
        │ no
        ▼
doc := buildBatonDocument(doc.text)
        │
        ▼
results := []
for each rule in allValidationRules where rule.scope !== 'document':
    for each query in doc.queries:
        out := rule.validate(query.normalizedSql, doc.yamlContent, { query, document: doc })
        results.push(...normalizeArray(out))
for each rule in allValidationRules where rule.scope === 'document':
    out := rule.validate("", doc.yamlContent, { document: doc })
    results.push(...normalizeArray(out))
        │
        ▼
diagnostics := results.filter(r => !r.isValid).map(toDiagnostic)
diagnostics := dedupe(diagnostics, (message, range.start.line, range.start.character))
            // verbatim copy of today's dedup logic from server.ts:182-188
        │
        ▼
documentCache.set(hash, diagnostics)
uriToHash.set(uri, hash)   // for eviction on onDidClose
        │
        ▼
sendDiagnostics(diagnostics)
```

**Ordering:** Document-scope rules run **after** all query-scope rules to preserve today's diagnostic ordering and therefore today's dedup outcome.

### Caching

One cache: `documentCache: Map<contentHash, Diagnostic[]>`. We do **not** cache the `BatonDocument` itself — that holds full ASTs and can grow MB-scale per document. Rebuilding it on miss is cheap (single YAML parse + N SQL parses, all already done on miss anyway).

A side index `uriToHash: Map<uri, contentHash>` tracks which hash a given document last produced so `onDidClose` can `documentCache.delete(uriToHash.get(uri))` and avoid unbounded growth across a session.

This replaces both today's caches: `fileDigests` in `server.ts` and `validationCache` in `sqlValidator.ts`.

## Rule API

Additive change to `ValidationRule`:

```ts
interface ValidationRule {
  name: string;
  description: string;
  scope?: 'query' | 'document';    // NEW, defaults to 'query'
  validate(
    sql: string,                   // unchanged — the SQL to validate
    yamlContent: string,           // RENAMED from 'originalQuery' — full YAML document text
    ctx?: RuleContext              // NEW, optional
  ): ValidationResult | ValidationResult[];   // return type widened
}
```

- **Existing 14 rules are not edited.** They ignore the new `ctx` arg (JS allows extra args). The parameter rename `originalQuery → yamlContent` is internal — rule bodies reference the parameter by their local name. They return a single `ValidationResult` (still valid in the widened type). Their tests pass byte-identical.
- **New rules opt in** by reading `ctx.query.ast`, `ctx.query.usedParams`, `ctx.document.definedEntitlementIds`, etc. Query-scope rules destructure `ctx.query` after narrowing.
- **`scope: 'document'` rules** are invoked once per document with `sql=""`, `yamlContent=document.yamlContent`, `ctx.query=undefined`. They use `ctx.document` only.

### `validateSql` — backward-compat shim

```ts
function validateSql(
  sql: string,
  originalQuery: string,
  onRuleError?: RuleErrorHandler
): ValidationResult[]
```

External signature preserved. Implementation in PR1 becomes:

1. Build a **single-query degraded BatonDocument**: empty resourceTypes/actions/cross-doc sets; `queries: [{ rawSql: sql, normalizedSql: normalize(sql), ast: try-parse, ..., yamlPath: [], startOffset: 0, endOffset: sql.length, varsScope: Map(), usedParams: extractFromRaw(sql) }]`; `yamlContent: originalQuery`.
2. Iterate all rules over the single query (skipping `scope:'document'` rules — there are none in PR1, and tests call this with raw SQL not YAML).
3. Collect `ValidationResult[]` with the error-swallowing behavior already there.

This preserves the 5 `sqlValidator.test.ts` tests byte-identical. The production hot path in `server.ts` no longer routes through `validateSql`; it calls `buildBatonDocument` + iterates rules directly. `validateSql` remains the public single-query entry point for unit tests and any external caller.

## Testing strategy

**Foundation PR adds the following new tests** (none of the existing 75 are edited):

- `document.test.ts`: yaml-to-model coverage on a representative fixture; multi-resource-type documents; degraded-doc behavior when YAML is invalid; aggregation of `definedEntitlementIds.literal` and `.expression`; `knownResourceTypeIds`; vars scope resolution on each path from the table above.
- `parsedQuery.test.ts`: AST/astError set correctly; `usedParams` matches a known set of `?<param>` occurrences; `yamlPath` mixed-type values (`['grants', 2, 'query']`) round-trip.
- `cache.test.ts`: documentCache invalidates on content change; `uriToHash` eviction works on close; same content across two URIs returns equivalent diagnostics from cache.
- `pipeline.test.ts`: **NEW backward-compat smoke tests** that drive the full `buildBatonDocument` → rule-loop → `Diagnostic[]` flow on a fixture and snapshot the output. (Distinct from the existing 14 rule tests, which call `rule.validate(sql, sql)` directly and bypass the pipeline.)

**Foundation PR does NOT add tests for new rule behavior** — there is no new rule behavior.

## Rollout

| PR | Scope | LOC | Behavior change |
|---|---|---|---|
| **PR1 — Foundation** | new types, `buildBatonDocument`, `parsedQuery`, `documentCache`, `validateSql` shim, `server.ts` rewire, new tests for builder/cache/pipeline smoke. **Default dialect only.** | ~600-800 | None |
| **PR2 — Dialect-aware parsing** | Add `ParsedQuery.dialect`; map `connect.scheme` → `node-sql-parser` dialect; fall back to default on unknown. New fixtures for postgres/mysql-specific syntax demonstrating which diagnostics change. | ~150 | **Yes** — dialect-specific SQL parses correctly; some false positives from string fallbacks disappear. Diagnostic deltas listed in the PR description. |
| **PR3 — Fix the two broken rules** | `batonParameterValidationRule` + `varsQueryMismatchRule` read `ctx.query.rawSql` and `ctx.query.varsScope`/`ctx.query.usedParams`. Treat `limit`/`offset`/`cursor` as built-ins (matches `bsql/validate.go`). | ~150 | These rules start firing in production. |
| **PR4 — Connector-mirror shape rules** | `scope` enum with did-you-mean, `random_password.constraints` validator, `DatabasesConfig` `static` ⊕ `discovery_query`. All document-scoped. | ~150 | New error categories. |
| **PR5 — Action validation** | `ActionConfig` `query` ⊕ `queries`, `ArgumentConfig` `required: true` conflicts with `default`. Document-scoped. | ~100 | New error categories. |
| **PR6 — Cross-query references** | `grants[].map.entitlement_id` matched against `definedEntitlementIds.literal`; if the document has dynamic entitlements, expression-side gets a softer "not verifiable" hint rather than an error. `principal_type` references defined resource types via `knownResourceTypeIds`. | ~200 | New error categories. |
| **PR7 — Column-trait coherence** | Ships a minimal **CEL-reference extractor** (`extractColumnRefs(expr: string): string[]`) covering the patterns observed in real configs: `.col`, `.col1 + ... + .col2`, `slugify(.col)`. Uses it to verify `map.traits.<role>.<field>` references columns present in the corresponding `list.query` SELECT. Also: `static_entitlements[].id` uniqueness within resource type. | ~300-400 | New error categories. |
| **PR8 (optional)** | AST-driven cleanup of `keywordSpellingRule` + `trailingCommaRule` using `ctx.query.ast`. | ~200 (mostly deletions) | Better ranges, same diagnostics. |

Each PR2-PR8 is self-contained, can be reviewed independently, and can be reverted independently. Order is suggested but not strict; PR3 is the highest user-value follow-up (fixes regressions that exist today).

## Decisions made (vs. alternatives considered)

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Dialect detection deferred to PR2 | Include dialect in PR1 | Including dialect breaks the "zero behavior change" guarantee. Splitting it out keeps PR1 reviewable as a pure refactor and isolates the diagnostic deltas to one focused PR. |
| `validateSql` preserved as a shim | Remove entirely; have server orchestrate only | The 5 existing `sqlValidator.test.ts` tests are the contract for `validateSql` as a single-query entry point. Keeping it ensures those tests still mean something and external callers (if any) don't break. |
| `definedEntitlementIds` split into `literal` + `expression` | Single `Set<string>` | Static entitlements have literal IDs; dynamic ones are CEL expressions. A single Set forces PR6 to make either false-positive or false-negative tradeoffs. Splitting lets PR6 do honest best-effort matching. |
| Cache holds `Diagnostic[]` only, not `BatonDocument` | Cache `BatonDocument + Diagnostic[]` | BatonDocument carries full ASTs — MB-scale per document, dangerous across N open documents. Rebuilding on miss is cheap. |
| `RuleContext.query?: ParsedQuery` (optional) | Two context types or two rule interfaces | Simplest API for PR1; the narrowing boilerplate is one line. Revisit when document-scoped rule count justifies the type machinery. |
| Document rules run AFTER query rules | Run before, or interleave | Today's dedup keeps the first occurrence; preserving query-rule ordering means the dedup outcome is byte-identical. |
| Rename `originalQuery → yamlContent` in the interface | Keep misleading name for compat | Parameter names don't affect callers in JS. Renaming costs nothing and removes a real source of confusion for future rule authors. |

## Risks

- **PR1 is a big diff.** Mitigation: zero behavior change is enforced by all 75 existing tests passing unchanged, plus new `pipeline.test.ts` smoke tests that snapshot full-pipeline output. Reviewers focus on structural correctness.
- **Degraded-doc handling could mask real errors.** Mitigation: on YAML parse failure we return early in `server.ts` (today's behavior) before invoking rules. Degraded BatonDocument exists only for the `validateSql` shim path.
- **Memory growth via documentCache.** Mitigation: only `Diagnostic[]` is cached; `uriToHash` enables eviction on close. Worst case bounded by the number of open documents.
- **PR2 (dialect) will produce diagnostic deltas.** Mitigation: PR2 ships dedicated fixtures showing every diagnostic that changes; reviewers explicitly accept the deltas.

## Open questions

None at brainstorming-close. Implementation plan will surface the per-PR details.
