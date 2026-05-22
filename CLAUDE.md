# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension that provides validation, IntelliSense, snippets, and JSON-schema enforcement for ConductorOne **Baton SQL** YAML configuration files (`baton-sql-*.yaml` / `*.yml`). It is implemented as an **LSP client/server pair** inside one extension, so most logic lives in the language server and the client is a thin shim.

## Commands

```
npm install            # one-time
npm run build          # webpack production build → out/client/extension.js + out/server/server.js
npm run watch          # webpack dev mode watcher (rebuilds on save)
npm run lint           # eslint src --ext .ts
npm run lint:fix
npm test               # node:test runner via tsx — runs every src/**/*.test.ts
npm run security:audit # npm audit + lint
npm run package        # vsce package → baton-sql-extension-<version>.vsix
```

Tests are co-located with implementation (`src/.../foo.ts` ↔ `src/.../foo.test.ts`), and are excluded from the webpack production bundle via `tsconfig.json` `exclude`. Run a single test file with `node --import tsx --test src/validation/rules/missingCommaRule.test.ts`.

For UI-level verification (hover, completion, code actions, go-to-def), `npm run build` and then `F5` in VS Code to launch an Extension Development Host on a `baton-sql-*.yaml` fixture. The language server can be attached on port `6009` (set in `src/client/extension.ts` via `--inspect=6009`).

## Architecture

### Two webpack bundles, one extension

`webpack.config.js` produces **two** CommonJS bundles:

- `out/client/extension.js` — entry `src/client/extension.ts`. Tiny LSP client that registers a `documentSelector` for `**/baton-sql-*.{yaml,yml}` and spawns the server over IPC. This is what `package.json` `main` points at.
- `out/server/server.js` — entry `src/server/server.ts`. All real work happens here: parsing, validating, hovering, completing, code actions, go-to-definition.

If you add a new VS Code command, register it inside `src/client/extension.ts` (the activated client) and add the `contributes.commands` entry in `package.json`. There is no other code path that runs in the host.

### Validation pipeline (server side)

`src/server/server.ts` `validateTextDocument()` is the hot path on every change/open:

1. **Cheap-skip**: hash document content (`hashString` in `utils/fileUtils.ts`); bail if unchanged. There is a per-document `fileDigests` cache and a per-query `validationCache` (in `validation/sqlValidator.ts`) — both are content-hashed and self-invalidate. When developing a new rule, call `clearValidationCache()` between iterations or hashes will mask the new behavior.
2. **Parse YAML** → `parseYaml` (`utils/yamlUtils.ts`).
3. **Locate SQL queries** inside the YAML → `findSQLQueries` returns `SQLQueryInfo[]` with byte offsets used to position diagnostics back into the document.
4. **Run every rule in `allValidationRules`** (`src/validation/rules/index.ts`) against each query. Each rule is a `ValidationRule { name, description, validate(sql, originalQuery) }` returning `ValidationResult { isValid, errorMessage?, position?, lineNumber?, suggestedFix? }`. If a rule throws, the error is reported to the optional `onRuleError` callback (the server logs it via `connection.console.error`) and the remaining rules still run — one bad rule must not break the others, but the error must not be invisible either.
5. **Emit diagnostics** via `connection.sendDiagnostics`. Range comes from `lineNumber` (preferred), then `position` offset into the query, falling back to the full query span. Diagnostics are then deduplicated by `(message, start.line, start.character)` because the same SQL often appears in multiple YAML blocks.
6. **Store suggested fixes** keyed by URI+diagnostic in `codeActionProvider.storeDiagnosticFix` so `onCodeAction` can return them as `WorkspaceEdit`s.
7. **Index symbols** for go-to-definition via `SymbolIndex.indexDocument`.

### Adding a new validation rule

1. Create `src/validation/rules/<name>Rule.ts` exporting `const <name>Rule: ValidationRule = { name, description, validate }`.
2. Export it from `src/validation/rules/index.ts` **and** append it to the `allValidationRules` array — registration is array-driven, not auto-discovered.
3. Set `lineNumber` (relative to the original document) **or** `position` (byte offset within the query) so the diagnostic underlines the right span; otherwise it highlights the whole query block.
4. Optionally return `suggestedFix: TextEdit` to get a lightbulb quick-fix for free.
5. Write `<name>Rule.test.ts` next to it. Use `node:test`'s `test()` and call `myRule.validate(sql, sql)` directly (skipping `validateSql`'s cache + normalization). At minimum: one valid case, one invalid case, and a regression test for any bug your rule was specifically introduced to catch.

**Gotcha:** `validateSql` calls `normalizeSQL` on the query before passing it to rules, which replaces `?<param>` with `?`. Rules whose logic depends on seeing `?<param>` in the `sql` argument (currently `batonParameterValidationRule` and `varsQueryMismatchRule`) will not fire through the production pipeline; they only run correctly when invoked directly. If you write a rule that needs Baton-parameter awareness, read from `originalQuery` (which is unnormalized) or thread an unnormalized SQL through separately.

### LSP feature providers

Each capability lives in its own file under `src/server/features/`: `hoverProvider`, `completionProvider`, `codeActionProvider`, `definitionProvider`. They are wired into the `connection.on*` handlers at the bottom of `server.ts`. Documentation strings for hover/completion come from `src/server/documentation/` (`sqlKeywords.ts`, `batonParameters.ts`).

### Schema and snippets (no code path)

- `schemas/baton-schema.json` — applied to matching files via the `yamlValidation` contribution in `package.json`. The Red Hat YAML extension is a hard `extensionDependencies` entry; schema work flows through it, not through our LSP server.
- `snippets/baton-sql.json` — VS Code snippet contribution; pure data.

When changing what counts as a valid Baton SQL config, you almost always need to update **both** the JSON schema and the relevant validation rule — the schema catches structural issues, the rules catch SQL-level ones.

## Conventions worth knowing

- `node-sql-parser` is the shared AST dependency most rules build on. Go through `getParser` / `parseSQL` / `hasFromClause` / `extractTableNames` / `extractAliases` etc. in `src/utils/sqlUtils.ts` rather than re-instantiating the parser per rule — keeps dialect config consistent and avoids the parser's nontrivial init cost on the hot path.
- `eslint-plugin-security` warns on non-literal regexes. If a dynamic regex is intentional, prefer a one-line `eslint-disable` with a reason over refactoring around the warning.
- Version bumps go in `package.json` and `CHANGELOG.md` together. `out/` and `*.vsix` are gitignored — don't try to commit build artifacts.
