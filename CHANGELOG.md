# Change Log

All notable changes to the "Baton SQL Extension" will be documented in this file.

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
