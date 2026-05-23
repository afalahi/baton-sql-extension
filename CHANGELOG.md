# Change Log

All notable changes to the "Baton SQL Extension" will be documented in this file.

## [1.9.0] - 2026-05-23

### Added

Two new document-scope validation rules covering cross-query reference integrity:

- **`principal-type-reference`** — flags `grants[].map[].principal_type` values that look like literal identifiers but don't name any defined `resource_types` key. Surfaces a `Did you mean '<resource_type>'?` suggestion when a close match exists (Levenshtein distance ≤ 2).
- **`entitlement-id-reference`** — flags `grants[].map[].entitlement_id` values that look like literals but don't match any `static_entitlements[].id` in the document. Skips entirely on documents that define no static entitlements (to avoid false positives in dynamic-entitlements-only configs). Surfaces a did-you-mean suggestion when applicable.

Both rules apply a conservative heuristic — values containing dots, quotes, operators, or whitespace are treated as CEL/jq expressions and skipped without checking.

### Behavior deltas

Configs that misspell a resource_type name in `principal_type`, or reference an entitlement that doesn't exist in `static_entitlements`, now produce diagnostics in the editor. Configs using expression-style references see no change.

## [1.8.0] - 2026-05-23

### Added

Two new document-scope validation rules covering action configuration:

- **`action-query-shape`** — validates each action under `actions:` specifies exactly one of `query` (single SQL string) or `queries` (array). Fires for both the "both set" and "neither set" cases. Mirrors `ActionConfig.oneOf` from the schema with clearer error messages than the Red Hat YAML extension's schema output.
- **`arg-required-default`** — validates that an action argument with `required: true` does not also specify a `default` value. The two are semantically contradictory. The schema's `ArgumentConfig.default` description notes this constraint but doesn't enforce it structurally; this rule promotes it to a real check.

### Behavior deltas

Users whose `actions:` blocks combine `query` + `queries`, omit both, or set both `required: true` and `default` on the same argument will now see in-editor diagnostics. Users with correct configs see no change.

## [1.7.0] - 2026-05-23

### Added

Three new document-scope validation rules that mirror static checks from `baton-sql/pkg/bsql/validate.go`:

- **`scope-enum`** — validates the `scope:` field on `list` / `entitlements` / `grants[]` is empty or `"cluster"`. Surfaces a `Did you mean 'cluster'?` suggestion for typos within Levenshtein distance 2 (e.g., `clustr`, `cluser`, `clustar`). Mirrors `validateScope`.
- **`random-password-constraints`** — validates each entry in `account_provisioning.credentials.random_password.constraints[]` has a non-empty `char_set` and `min_count > 0`. Mirrors `validatePasswordConstraints`.
- **`databases-config`** — validates `connect.databases` does not set both `static` and `discovery_query`. The JSON schema already enforces this via `oneOf`; the rule provides faster in-editor feedback.

### Behavior deltas

Users with these specific misconfigurations will now see diagnostics in the editor instead of discovering them at connector startup. Users with correct configs see no change.

## [1.6.0] - 2026-05-23

### Fixed

- **`batonParameterValidationRule` now fires in production.** The rule scans for `?<name>` patterns; previously it received the normalized SQL (with `?<name>` already replaced by `?`) and never matched. It now reads the un-normalized SQL via `ctx.query.rawSql`. Configs using a Baton param named after a SQL keyword (e.g., `?<select>`), with an invalid character (e.g., `?<user-id>`), or with a too-short name will now surface diagnostics.
- **`varsQueryMismatchRule` now fires in production** and uses the correctly-scoped `vars:` block from `ctx.query.varsScope` instead of scanning the entire YAML document. Configs whose query references a param not in the resource type's own `vars:` block now produce a diagnostic, and configs that define a `vars:` entry never referenced by the query do too.

### Added

- **Built-in vars `limit`, `offset`, `cursor`** are now treated as automatically defined by `varsQueryMismatchRule`, matching `baton-sql/pkg/bsql/validate.go`'s `validateVarsInQuery`. Paginated queries like `... LIMIT ?<limit> OFFSET ?<offset>` no longer need redundant `vars:` entries.

### Behavior deltas

Users will see two new categories of diagnostics on misconfigured YAML files. These were silently passing before PR3:

- `Baton parameter name '<name>' conflicts with SQL keyword` / `is too short` / contains invalid characters
- `Query uses parameter ?<name> but it's not defined in 'vars'` / `Variable(s) defined in 'vars' but not used in query`

Diagnostic priority when both apply: undefined first (matches the connector's `validateVarsInQuery` priority). Users with correct configs see no change.

## [1.5.0] - 2026-05-22

### Changed

- **Dialect-aware SQL parsing.** `connect.scheme` is now passed through to `node-sql-parser` as its `database` option. Postgres-specific syntax (e.g., `ON CONFLICT`, `RETURNING`, `::type` casts), SQL Server `TOP`, and other dialect-specific constructs now parse correctly. `ParsedQuery.ast` is populated for these queries where it was previously `null`.

### Added

- New `src/validation/dialect.ts` exporting `schemeToDialect(scheme?)`. Recognized schemes: `pg`/`postgres`/`postgresql` → `postgresql`; `mysql`/`mysql2`/`mariadb` → `mysql`; `sqlserver`/`mssql`/`tsql` → `transactsql`; plus `sqlite`, `snowflake`, `bigquery`, `redshift`, `db2`. Schemes the connector supports but `node-sql-parser` doesn't (`oracle`, `hdb`) fall back to the default dialect.
- `ParsedQuery.dialect` records the dialect used by the parse (undefined = default).

### Behavior deltas

This release is **foundational** — the current rule set does not produce visibly different LSP diagnostics in PR2. AST-driven rules only fire on SELECT, while the dialect-specific constructs that newly parse correctly are mostly in INSERT/UPDATE/DELETE shapes. The visible improvements will come in subsequent releases as new rules opt into the now-correct AST (e.g., dialect-specific column extraction for column-trait coherence). Users without `connect.scheme` see no change in this release.

## [1.4.0] - 2026-05-21

### Changed

- Realigned `schemas/baton-schema.json` with the canonical `baton-sql/pkg/bsql/config.go` to stop flagging valid configs as invalid.

### Added

- **`connect`** now accepts structured fields (`scheme`, `host`, `port`, `database`, `params`) in addition to a DSN; either a DSN or `scheme + host + database` is required.
- **`connect.databases`** for per-database iteration (`static` list or `discovery_query`).
- **`resource_types[].skip_entitlements_and_grants`** flag.
- **`list` / `entitlements` / `grants`**: `vars` and `scope: cluster` for opting out of per-database iteration.
- **`map`**: `annotations` (entitlement_immutable, external_link).
- **User traits**: `mfa_enabled`, `sso_enabled`, `login_aliases`.
- **App traits**: `help_url`.
- **`pagination.page_size`** (1–1000).
- **EntitlementMapping**: `slug`, `immutable`, `skip_if`, `provisioning` (now uniformly available on both static and dynamic entitlements), and the new `exclusion_group` shape.
- **EntitlementProvisioning**: `validation_queries`, `no_transaction`, and `grant.grant_replace` for grant-replace flows.
- **GrantMapping**: `annotations`, `entitlement_resource_id`.
- **`account_provisioning.schema[].type`** now accepts `string_list` and `map` in addition to `string`, `boolean`, `int`.
- **`account_provisioning.credentials.random_password.constraints`** (char_set + min_count) for character-set rules.
- **`account_provisioning`** now requires `credentials`, `create`, and `validate` (the connector's `staticValidate` fails without them).
- **`actions`**: `queries` array alternative to `query`, plus `vars` and `no_transaction`.

### Fixed

- **Credentials**: removed the `oneOf` restriction that forced exactly one of `no_password` / `random_password` / `encrypted_password`. The canonical connector allows multiple strategies simultaneously, with `preferred: true` picking the default.
- **`actions[].action_type`** enum updated to canonical values: `unspecified`, `dynamic`, `account`, `account_update_profile`, `account_disable`, `account_enable` (was `account_enable`, `account_disable`, `custom`).
- **`actions[].arguments[].type`** enum updated to canonical: `string`, `boolean`, `number`, `string_list`, `string_map` (was `string`, `int`, `boolean`).
- **`random_password`**: `max_length`, `min_length`, `disallowed_characters` are now optional and marked deprecated (the canonical struct documents them as not implemented).
- Removed top-level `entitlements`, `grants`, and `static_entitlements` from the schema — they aren't part of the connector's `Config` struct and any value there was silently ignored.
- Bug: `ambiguousColumnsRule` no longer misses `SELECT *` across multiple tables (node-sql-parser returns `column_ref` for `*`, not the string `"*"`).
- Bug: `invalidGroupByRule` no longer falsely flags valid `GROUP BY` queries (the parser returns an object with `columns`, not an array).
- Bug: `invalidJoinRule` no longer flags `CROSS JOIN` as missing an `ON` clause (CROSS JOIN intentionally has no ON).
- Bug: `unconventionalSqlSyntaxRule` no longer flags `ON CONFLICT (col) DO UPDATE`; the regex now allows an optional conflict target between `ON CONFLICT` and `DO …`.
- Silent rule exceptions are now logged via `connection.console.error` instead of being swallowed; one bad rule still doesn't break the others.

### Removed

- `credentialMutualExclusionRule` — the canonical `AccountCredentials` struct allows multiple credential strategies; this rule was flagging valid configs.
- Legacy non-LSP `src/extension.ts` (was never bundled by webpack).
- Orphaned `batonSQL.applySchema` command from `package.json` (its handler lived only in the deleted legacy file and called a function with an incorrect extension ID).

### Tooling

- Added `npm test` (node:test via tsx). 75 tests across all 14 validation rules and the validator orchestrator, including regression tests for the bugs above and the false positives fixed in v1.3.1 / v1.3.2.

## [1.3.3] - 2025-11-12

### Fixed

- Fixed issue with DSN validation when user and password properties are used instead of embedding in sql url.

## [1.3.2] - 2025-10-16

### Fixed

- Fixed false positive in missing comma validation for SELECT statements with UNION in subqueries
- The validation rule now properly tracks parenthesis depth to ignore subqueries in JOIN clauses
- Added support for UNION, INTERSECT, and EXCEPT as SELECT clause terminators
- SELECT statements containing complex subqueries with UNION operations now validate correctly

## [1.3.1] - 2025-10-11

### Fixed

- 🐛 Fixed false positive in missing comma validation for INSERT statements
- The validation rule no longer incorrectly flags lines like `INSERT INTO table (` or `VALUES (` as needing commas when the opening parenthesis is on its own line
- Multi-line INSERT statements with opening parentheses now validate correctly

## [1.3.0] - 2025-10-10

### Added

- ✨ **5 New Snippets** for modern Baton SQL patterns
  - `baton-actions` / `actions` / `bactions` - Custom actions (enable/disable user, etc.)
  - `baton-credential-rotation` / `credential-rotation` / `bcred` - Password rotation configuration
  - `baton-entitlement-provisioning` / `static-entitlement-provisioning` / `bentp` - Static entitlement with grant/revoke SQL
  - `baton-entitlements-query` / `entitlements` / `bentq` - Query-based dynamic entitlements
  - `baton-expandable-grants` / `expandable-grants` / `bexpand` - Grants with role expansion
- 🔍 **2 New Validation Rules**
  - `varsQueryMismatchRule` - Warns when vars defines unused variables or query uses undefined variables
  - `unconventionalSqlSyntaxRule` - Validates PostgreSQL-specific syntax (ON CONFLICT, RETURNING, gen_salt, crypt, COALESCE, etc.)
- 📋 **Schema Enhancements**
  - Added `actions` block for custom user actions (enable/disable accounts)
  - Added `description` as alternative to `app_description` at root level

### Changed

- 🔄 **Updated Existing Snippets** to use modern pattern
  - Replaced `skip_if` with `vars` + parameterized queries using `?<variable>` syntax
  - `baton-resource-grants` now uses `vars: { resource_id: resource.ID }` pattern
  - `baton-grants` now uses parameterized query pattern for filtering

### Improved

- 📝 Snippets now reflect modern Baton SQL best practices
- 🎯 Better alignment with Oracle EBS and real-world connector patterns
- 🛡️ Enhanced validation for PostgreSQL-specific features

## [1.2.0] - 2025-10-10

### Added

- ✨ **YAML Snippets** for rapid scaffolding of Baton SQL configurations
  - `baton-resource` / `resource-type` / `brt` - Basic resource type with list query
  - `baton-resource-grants` / `resource-type-grants` / `brtg` - Resource type with grants
  - `baton-resource-provisioning` / `resource-type-provisioning` / `brtp` - Resource type with account provisioning
  - `baton-account-provisioning` / `account-provisioning` / `bacc` - Account provisioning block
  - `baton-grants` / `grants` / `bgrants` - Grants configuration block
  - `baton-entitlement` / `static-entitlement` / `bent` - Static entitlement definition
  - `baton-query` / `query` / `bquery` - Query block template

### Changed

- 📝 Improved snippet discoverability by adding "baton-" prefix alternatives
- 📝 Enhanced authoring experience with tab-completion scaffolds

## [1.1.1] - 2025-10-10

### Fixed

- 🐛 Fixed missing comma validation not working for all SQL queries (e.g., `account_provisioning.validate.query`)
- 🔧 Validation rules now correctly receive the SQL query instead of entire YAML file for line-by-line analysis

## [1.1.0] - 2025-10-10

### Changed

- 🚀 **Reduced extension size by 84%** (13MB → 2MB compressed, 100MB → 6.8MB uncompressed)
- ⚡ Webpack now bundles all dependencies for faster installation
- 📝 Updated documentation for accurate editor support clarity

### Fixed

- 🔒 Resolved 4 security linting warnings for regex patterns (false positives)
- 🛡️ Added ESLint security configuration with recommended rules

### Improved

- 📦 Optimized packaging by bundling node-sql-parser and js-yaml with webpack
- 🧹 Cleaned up .vscodeignore to exclude unnecessary files

## [1.0.0] - 2025-10-10

### Added

- 🔍 Real-time SQL validation with 14 comprehensive rules
- 💡 Intelligent auto-completion for SQL keywords, functions, and Baton parameters
- 📖 Inline documentation via hover support
- ⚡ One-click quick fixes for common SQL errors
- 🎯 Go-to-definition for tables and resource types
- 🛡️ JSON Schema validation for baton-sql-*.yaml files
- 🏗️ Built with Language Server Protocol (LSP) for professional-grade features

### Validation Rules

- Missing comma detection (SELECT, INSERT, UPDATE statements)
- Keyword spelling correction (SELCT → SELECT, FRO → FROM, etc.)
- Unclosed parentheses detection
- Invalid JOIN syntax validation
- Ambiguous column reference detection
- GROUP BY validation with aggregate functions
- ORDER BY reference validation
- Duplicate alias detection
- Baton parameter syntax validation (?<parameter_name>)
- Credential mutual exclusion validation
- Property name typo detection
- Trailing comma detection
- FROM clause requirement validation
- Diagnostic deduplication to prevent repeated errors

### Features

- Automatic schema application for `baton-sql-*.yaml` files
- Context-aware completion suggestions
- Rich markdown formatting in hover documentation
- Quick fix lightbulb (💡) actions with Cmd+. / Ctrl+.
- F12 or Cmd+Click navigation to definitions
- Support for account provisioning, credential rotation, and more
- Integration with Red Hat YAML extension for schema validation
