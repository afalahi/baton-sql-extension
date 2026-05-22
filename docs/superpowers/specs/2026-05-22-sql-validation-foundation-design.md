# SQL Validation Foundation — Design

**Status:** Approved (brainstorming complete; PR1 implementation plan to follow)
**Date:** 2026-05-22
**Scope:** A staged refactor of `src/validation/` that introduces a shared parsed-document model so existing rules become more precise and new categories of rules (connector-aware, cross-query) become easy to add. The implementation plan that follows this design covers **PR1 (the foundation) only**; PR2-PR7 are sketched here for context but each will get its own plan when picked up.

## Context

The current validation pipeline (`src/validation/sqlValidator.ts`) calls each rule with `(sql, originalQuery)`. Most rules then re-parse the same SQL with `node-sql-parser` (or fall back to ad-hoc regex/string scanning), and rules cannot see anything outside the single query they're handed. This causes three classes of problem:

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
- No changes to `src/server/features/*` (hover, completion, code actions, go-to-def).
- No changes to the JSON schema or snippets.
- No new diagnostic messages in the foundation PR — those land in follow-up PRs.

## Architecture

### New types

```ts
ParsedQuery {
  rawSql: string              // ?<param> intact
  normalizedSql: string       // ?<param> → ?
  ast: any | null             // null if parse failed
  astError: string | null     // parser error message
  dialect: string             // 'postgres' | 'mysql' | 'default' | ...
  yamlPath: string[]          // e.g. ['resource_types','user','list','query']
  startOffset: number         // absolute byte offset in yamlContent
  endOffset: number
  varsScope: Map<string,string>  // vars visible at this query's location
  usedParams: Set<string>     // ?<param> names found in rawSql
}

BatonDocument {
  yaml: any                   // js-yaml parse result
  yamlContent: string         // raw text (for ranges)
  connect: ConnectConfig | undefined
  resourceTypes: Map<string, ResourceTypeDef>
  actions: Map<string, ActionDef>
  queries: ParsedQuery[]      // flat list across the whole document
  definedEntitlementIds: Set<string>
  knownResourceTypeIds: Set<string>
}

RuleContext {
  query?: ParsedQuery         // present for scope: 'query' rules; undefined for scope: 'document'
  document: BatonDocument
}
```

### New entry point

```ts
buildBatonDocument(yamlContent: string): BatonDocument
```

Pure function. Parses YAML once, walks the resulting object into the typed model, locates each SQL string with its absolute offset, parses each into an AST using the dialect derived from `connect.scheme` (postgres / mysql / sqlserver / oracle / hdb, or default if unset/unrecognized), pre-computes `varsScope` per query, and aggregates document-level sets (`definedEntitlementIds`, `knownResourceTypeIds`).

### Data flow

```
LSP onDidChange
        │
        ▼
hash(yamlContent) ─► cache hit? ─► reuse cached Diagnostic[]
        │ miss
        ▼
buildBatonDocument(yamlContent)
        │
        ▼
for each rule in allValidationRules:
    if rule.scope === 'document':
        run rule.validate(_, yamlContent, { document })  ← once per doc
    else:
        for each query in document.queries:
            run rule.validate(query.normalizedSql, yamlContent, { query, document })
        │
        ▼
collect ValidationResult[], dedupe, send Diagnostic[] to client
        │
        ▼
cache { contentHash → Diagnostic[] }
```

### Caching

Today there are two caches: per-document `fileDigests` (in `server.ts`) and per-query `validationCache` (in `sqlValidator.ts`). Both keyed by content hash. The new design consolidates: one `documentCache` keyed by `hashString(yamlContent)`, value is the built `BatonDocument` + the `Diagnostic[]`. Single source of invalidation. The per-query `validationCache` is removed.

## Rule API

Additive change to `ValidationRule`:

```ts
interface ValidationRule {
  name: string;
  description: string;
  scope?: 'query' | 'document';    // NEW, defaults to 'query'
  validate(
    sql: string,
    originalQuery: string,
    ctx?: RuleContext              // NEW, optional
  ): ValidationResult | ValidationResult[];   // return type widened
}
```

- **Existing 14 rules are not edited.** They ignore the new `ctx` arg (JS allows extra args). They return single `ValidationResult` (still valid in the widened type). Their tests pass byte-identical.
- **New rules opt in** by reading `ctx.query.ast`, `ctx.query.usedParams`, `ctx.document.definedEntitlementIds`, etc.
- **`scope: 'document'` rules** are invoked once per document with `sql=""`, `originalQuery=yamlContent`, `ctx.query=undefined`. They use `ctx.document` only.

## Testing strategy

**Foundation PR adds tests for:**

- `buildBatonDocument`: yaml-to-model coverage on a representative fixture; absent fields default sensibly; multi-resource-type documents.
- `ParsedQuery`: dialect derived correctly from each supported `connect.scheme`; vars scope captured from nested vars blocks; `usedParams` matches a known set of `?<param>` occurrences.
- Cache invalidation: changing one byte of YAML rebuilds; re-reading same YAML returns cached value.
- Backward-compat smoke: every existing rule still produces identical results on the existing test fixtures.

**Foundation PR does NOT add tests for new rule behavior** — there is none.

## Rollout

| PR | Scope | LOC | Behavior change |
|---|---|---|---|
| **PR1 — Foundation** | new types, `buildBatonDocument`, `sqlValidator` rewire, `server.ts` rewire, new tests for builder. | ~600-800 | None |
| **PR2 — Fix broken rules** | `batonParameterValidationRule` + `varsQueryMismatchRule` read `ctx.query.rawSql`; varsQueryMismatch recognizes `limit`/`offset`/`cursor` as built-ins (matches `bsql/validate.go`). | ~150 | These rules start firing in production |
| **PR3 — Connector-mirror shape rules** | `scope` enum with did-you-mean, `random_password.constraints` validator, `DatabasesConfig` static XOR discovery_query. | ~150 | New error categories |
| **PR4 — Action validation** | `ActionConfig` query XOR queries, `ArgumentConfig` required+default conflict. | ~100 | New error categories |
| **PR5 — Cross-query references** | `grants[].map.entitlement_id` references defined entitlement, `principal_type` references defined resource type. | ~200 | New error categories |
| **PR6 — Column-trait coherence** | `map.traits.<role>.<field>: ".col"` requires `col` in corresponding `list.query` SELECT; `static_entitlements[].id` uniqueness. | ~250 | New error categories |
| **PR7 (optional)** | AST-driven cleanup of `keywordSpellingRule` + `trailingCommaRule`. | ~200 (mostly deletions) | Better ranges, same diagnostics |

Each PR2-PR7 is self-contained, can be reviewed independently, and can be reverted independently. Order is suggested but not strict; PR2 is the highest user-value follow-up.

## Decisions made (vs. alternatives considered)

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Optional 3rd `ctx` arg on existing `ValidationRule` interface | Introduce a parallel `RuleV2` interface | Optional arg is zero-cost backward compat. A parallel interface would force a mass migration. |
| Single `documentCache` keyed by YAML hash | Keep separate per-query cache | Per-query cache buys nothing once we parse-once-per-document. Removes a redundant invariant. |
| Dialect from `connect.scheme` | Hardcoded `'postgres'` | Connector supports five dialects; passing the right one cuts the false-positive rate on dialect-specific SQL. |
| Absolute offsets on `ParsedQuery` | Continue using `lineNumber/position` relative to query | Foundation PR keeps relative; can revisit. Wire format must not change in PR1. |
| `scope: 'document'` rules get `sql: ""` | A dedicated `validateDocument()` signature | Smaller API surface. Document rules read `ctx.document` only and don't care about `sql`. |

## Risks

- **PR1 is a big diff.** Mitigation: zero behavior change is enforced by the 75-test suite; reviewers can focus on structural correctness.
- **Dialect detection regresses something.** If the user's `connect.scheme` is set to something `node-sql-parser` doesn't recognize, we must fall back to default (today's behavior), not crash. Test fixture for unrecognized scheme.
- **Document-scoped rules emit diagnostics with ambiguous ranges.** Mitigation: PR3+ rules set explicit ranges via `lineNumber` derived from yaml path lookup.

## Open questions

None at brainstorming-close. Implementation plan will surface the per-PR details.
