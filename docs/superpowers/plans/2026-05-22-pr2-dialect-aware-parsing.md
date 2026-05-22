# Dialect-Aware Parsing (PR2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass `connect.scheme` from the YAML through to `node-sql-parser` so postgres/mysql/sqlserver-specific SQL parses correctly instead of falling through to brittle string-based code paths in the rules.

**Architecture:** Add a new `schemeToDialect` helper that maps user-facing scheme names (`postgres`, `mysql`, `sqlserver`, `oracle`, `hdb`, …) to `node-sql-parser`'s `database` option (`'postgresql'`, `'mysql'`, `'transactsql'`, undefined for unsupported). Plumb the resulting dialect through `ParseQueryInput` → `parseQuery` → `parser.astify(sql, { database })`. `buildBatonDocument` reads `connect.scheme` once and passes the resolved dialect to every `buildQueryIfPresent` call.

**Tech Stack:** TypeScript 4.x strict, `node-sql-parser` 5.3.9 (supports `mysql` (default), `postgresql`, `transactsql`, `mariadb`, `bigquery`, `snowflake`, `sqlite`, etc. via the `database` option), node:test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md` (Rollout, "PR2 — Dialect-aware parsing").

**Behavior delta:** YES — this PR changes diagnostic output. SQL that the default (`mysql`) parser previously rejected now parses successfully when `connect.scheme` is set, which means rules that have AST-then-string-fallback paths now stay on the AST path and emit different (typically zero) diagnostics. The "zero behavior change" guarantee from PR1 ends here. See Task 5 for the documented deltas.

---

## File Structure

**New files:**
- `src/validation/dialect.ts` — `schemeToDialect()` helper + tests
- `src/validation/dialect.test.ts`

**Modified files:**
- `src/validation/parsedQuery.ts` — add `dialect` to `ParsedQuery` + `ParseQueryInput`; pass `{ database }` option to `parser.astify`
- `src/validation/document.ts` — resolve dialect once from `connect.scheme`, pass to every `buildQueryIfPresent` call (which threads it into `parseQuery`)
- `src/validation/parsedQuery.test.ts` — add dialect-specific parse tests
- `src/validation/document.test.ts` — add an integration test that asserts queries carry the right dialect when `connect.scheme` is set
- `src/validation/pipeline.test.ts` — append a behavior-delta smoke test (postgres ON CONFLICT no longer triggers a string-fallback diagnostic)

**Not touched:**
- Any file in `src/validation/rules/`
- `src/validation/context.ts`, `types.ts`, `sqlValidator.ts`, `pipeline.ts`
- `src/server/`, `schemas/`, `snippets/`, build/lint config

**Tests after PR2:** 124 → ~134.

---

## Task 1: Add `schemeToDialect` helper

**Files:**
- Create: `src/validation/dialect.ts`
- Create: `src/validation/dialect.test.ts`

- [ ] **Step 1: Write the failing tests** in `src/validation/dialect.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemeToDialect } from './dialect';

test('schemeToDialect: postgres variants → postgresql', () => {
  assert.equal(schemeToDialect('postgres'), 'postgresql');
  assert.equal(schemeToDialect('postgresql'), 'postgresql');
  assert.equal(schemeToDialect('PostgreSQL'), 'postgresql');
  assert.equal(schemeToDialect('POSTGRES'), 'postgresql');
});

test('schemeToDialect: mysql variants → mysql', () => {
  assert.equal(schemeToDialect('mysql'), 'mysql');
  assert.equal(schemeToDialect('MySQL'), 'mysql');
  assert.equal(schemeToDialect('mariadb'), 'mysql');
});

test('schemeToDialect: sqlserver variants → transactsql', () => {
  assert.equal(schemeToDialect('sqlserver'), 'transactsql');
  assert.equal(schemeToDialect('mssql'), 'transactsql');
  assert.equal(schemeToDialect('tsql'), 'transactsql');
});

test('schemeToDialect: sqlite → sqlite', () => {
  assert.equal(schemeToDialect('sqlite'), 'sqlite');
});

test('schemeToDialect: snowflake → snowflake', () => {
  assert.equal(schemeToDialect('snowflake'), 'snowflake');
});

test('schemeToDialect: bigquery → bigquery', () => {
  assert.equal(schemeToDialect('bigquery'), 'bigquery');
});

test('schemeToDialect: oracle → undefined (no node-sql-parser support)', () => {
  // node-sql-parser 5.3.9 does not support Oracle. Fall back to default
  // so the parser at least attempts the query (mysql-flavored).
  assert.equal(schemeToDialect('oracle'), undefined);
});

test('schemeToDialect: hdb (SAP HANA) → undefined', () => {
  assert.equal(schemeToDialect('hdb'), undefined);
});

test('schemeToDialect: unknown scheme → undefined', () => {
  assert.equal(schemeToDialect('cockroach'), undefined);
  assert.equal(schemeToDialect('weird-thing'), undefined);
});

test('schemeToDialect: empty/undefined input → undefined', () => {
  assert.equal(schemeToDialect(''), undefined);
  assert.equal(schemeToDialect(undefined), undefined);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --import tsx --test src/validation/dialect.test.ts 2>&1 | tail -10
```

Expected: cannot find module `./dialect`.

- [ ] **Step 3: Implement `src/validation/dialect.ts`**

```ts
/**
 * Maps the user-facing `connect.scheme` value to a node-sql-parser `database`
 * option string. Returns undefined for schemes node-sql-parser doesn't support
 * (oracle, hdb, etc.) so the caller falls back to the default parser dialect.
 *
 * Case-insensitive on input.
 */
export function schemeToDialect(scheme?: string): string | undefined {
  if (!scheme) return undefined;
  const s = scheme.toLowerCase().trim();
  switch (s) {
    case 'postgres':
    case 'postgresql':
      return 'postgresql';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    case 'sqlserver':
    case 'mssql':
    case 'tsql':
    case 'transactsql':
      return 'transactsql';
    case 'sqlite':
      return 'sqlite';
    case 'snowflake':
      return 'snowflake';
    case 'bigquery':
      return 'bigquery';
    case 'redshift':
      return 'redshift';
    case 'db2':
      return 'db2';
    // Schemes the connector supports but node-sql-parser doesn't (5.3.9):
    case 'oracle':
    case 'hdb':
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: Run, verify all 10 tests pass**

```bash
node --import tsx --test src/validation/dialect.test.ts 2>&1 | tail -10
```

Expected: `pass 10`, `fail 0`.

- [ ] **Step 5: Run the full test suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 134` (124 from PR1 baseline + 10 new), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/dialect.ts src/validation/dialect.test.ts
git commit -m "validation: add schemeToDialect helper

Maps the connector's connect.scheme value (postgres, mysql, sqlserver,
mariadb, sqlite, snowflake, bigquery, redshift, db2) to node-sql-parser's
'database' option. Oracle and HDB return undefined — node-sql-parser 5.3.9
doesn't support them, so we fall back to the default (mysql-flavored)
parser for those schemes."
```

---

## Task 2: Thread `dialect` through `parseQuery`

**Files:**
- Modify: `src/validation/parsedQuery.ts`
- Modify: `src/validation/parsedQuery.test.ts`

- [ ] **Step 1: Append failing tests** to `src/validation/parsedQuery.test.ts`:

```ts
test('parseQuery: dialect postgresql parses ON CONFLICT', () => {
  const q = parseQuery({
    rawSql: 'INSERT INTO t (id) VALUES (1) ON CONFLICT DO NOTHING',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
    dialect: 'postgresql',
  });
  assert.notEqual(q.ast, null, 'postgresql dialect should parse ON CONFLICT');
  assert.equal(q.astError, null);
  assert.equal(q.dialect, 'postgresql');
});

test('parseQuery: default dialect (no dialect arg) fails ON CONFLICT', () => {
  // node-sql-parser's default dialect is mysql, which does not understand
  // postgres' ON CONFLICT clause. This test locks in the regression that
  // would otherwise creep in if someone forgot to pass dialect.
  const q = parseQuery({
    rawSql: 'INSERT INTO t (id) VALUES (1) ON CONFLICT DO NOTHING',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.equal(q.ast, null);
  assert.ok(q.astError, 'astError should be populated');
  assert.equal(q.dialect, undefined);
});

test('parseQuery: dialect transactsql parses SQL Server TOP', () => {
  const q = parseQuery({
    rawSql: 'SELECT TOP 5 id FROM users',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
    dialect: 'transactsql',
  });
  assert.notEqual(q.ast, null);
  assert.equal(q.dialect, 'transactsql');
});

test('parseQuery: clean SELECT parses regardless of dialect', () => {
  // Common SELECTs that any dialect should handle.
  for (const dialect of [undefined, 'mysql', 'postgresql', 'transactsql', 'sqlite']) {
    const q = parseQuery({
      rawSql: 'SELECT id, name FROM users WHERE id = 1',
      yamlPath: [],
      startOffset: 0,
      endOffset: 0,
      varsScope: new Map(),
      dialect,
    });
    assert.notEqual(q.ast, null, `dialect=${dialect} should parse the clean SELECT`);
    assert.equal(q.dialect, dialect);
  }
});
```

- [ ] **Step 2: Run, verify the 4 new tests fail**

```bash
node --import tsx --test src/validation/parsedQuery.test.ts 2>&1 | tail -15
```

Expected: TypeScript / runtime errors — `dialect` is not a recognized field on `ParseQueryInput` and `ParsedQuery`.

- [ ] **Step 3: Update `src/validation/parsedQuery.ts`** to add the `dialect` field and pass it to `astify`

Find the `ParsedQuery` interface and add `dialect: string | undefined` (place it after `astError`):

```ts
export interface ParsedQuery {
  /** Raw SQL with ?<param> tokens intact. */
  rawSql: string;
  /** SQL after `?<param>` → `?` normalization. */
  normalizedSql: string;
  /** AST from node-sql-parser, or null if parsing failed. */
  ast: any | null;
  /** Parser error message, or null. */
  astError: string | null;
  /** node-sql-parser dialect used for the parse (undefined = default/mysql). */
  dialect: string | undefined;
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
```

Find the `ParseQueryInput` interface and add the optional `dialect`:

```ts
export interface ParseQueryInput {
  rawSql: string;
  yamlPath: (string | number)[];
  startOffset: number;
  endOffset: number;
  varsScope: Map<string, string>;
  /** node-sql-parser dialect ('postgresql', 'mysql', 'transactsql', etc.). Undefined uses the default. */
  dialect?: string;
}
```

Find the `parseQuery` function and update the `astify` call to pass the dialect option. The new function body:

```ts
export function parseQuery(input: ParseQueryInput): ParsedQuery {
  const normalizedSql = normalizeSQL(input.rawSql);

  let ast: any | null = null;
  let astError: string | null = null;
  try {
    const options = input.dialect ? { database: input.dialect } : undefined;
    ast = options
      ? getParser().astify(normalizedSql, options)
      : getParser().astify(normalizedSql);
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
    dialect: input.dialect,
    yamlPath: input.yamlPath,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    varsScope: input.varsScope,
    usedParams,
  };
}
```

- [ ] **Step 4: Run the parsedQuery tests, verify all 11 pass** (7 prior + 4 new)

```bash
node --import tsx --test src/validation/parsedQuery.test.ts 2>&1 | tail -15
```

Expected: `pass 11`, `fail 0`.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 138` (134 from Task 1 + 4 new), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/parsedQuery.ts src/validation/parsedQuery.test.ts
git commit -m "validation: add dialect field to ParsedQuery + parseQuery

parseQuery now passes { database: <dialect> } to node-sql-parser's astify
when ParseQueryInput.dialect is set. Backward compatible: undefined dialect
uses the default (mysql) parser, matching today's behavior. ParsedQuery
records the dialect used so consumers can inspect."
```

---

## Task 3: Thread dialect through `buildBatonDocument`

**Files:**
- Modify: `src/validation/document.ts`
- Modify: `src/validation/document.test.ts`

- [ ] **Step 1: Append failing tests** to `src/validation/document.test.ts`:

```ts
import { schemeToDialect } from './dialect';

test('buildBatonDocument: passes connect.scheme dialect to every ParsedQuery', () => {
  const yaml = `
app_name: t
connect:
  scheme: postgres
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 2 FROM g
        map:
          - principal_id: ".id"
            principal_type: user
            entitlement_id: m
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries.length, 2);
  for (const q of doc.queries) {
    assert.equal(q.dialect, 'postgresql', \`yamlPath=\${JSON.stringify(q.yamlPath)} should be postgresql\`);
  }
});

test('buildBatonDocument: connect.scheme=mysql → dialect=mysql', () => {
  const yaml = `
connect:
  scheme: mysql
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries[0].dialect, 'mysql');
});

test('buildBatonDocument: connect.scheme=oracle → dialect=undefined (no parser support)', () => {
  const yaml = `
connect:
  scheme: oracle
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries[0].dialect, undefined);
});

test('buildBatonDocument: no connect.scheme → dialect=undefined', () => {
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
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries[0].dialect, undefined);
});

test('buildBatonDocument: ON CONFLICT in account_provisioning.create.queries parses with postgres scheme', () => {
  const yaml = `
connect:
  scheme: postgres
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
        query: "SELECT 1"
      create:
        queries:
          - "INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING"
`;
  const doc = buildBatonDocument(yaml);
  const conflictQ = doc.queries.find(q => q.rawSql.includes('ON CONFLICT'));
  assert.ok(conflictQ);
  assert.equal(conflictQ!.dialect, 'postgresql');
  assert.notEqual(conflictQ!.ast, null, 'ON CONFLICT should parse with postgres dialect');
  assert.equal(conflictQ!.astError, null);
});
```

- [ ] **Step 2: Run, verify the 5 new tests fail**

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -15
```

Expected: failures — every `q.dialect` will be `undefined` because `buildBatonDocument` doesn't yet pass it through.

- [ ] **Step 3: Update `src/validation/document.ts`** to resolve dialect and pass it to every `buildQueryIfPresent`

At the top of the file, add an import for the new helper:

```ts
import { schemeToDialect } from './dialect';
```

Update `buildQueryIfPresent` to accept and forward `dialect`. Find the existing signature and add the parameter:

```ts
function buildQueryIfPresent(
  yamlContent: string,
  rawSql: any,
  yamlPath: (string | number)[],
  varsScope: Map<string, string>,
  into: ParsedQuery[],
  dialect: string | undefined,
): ParsedQuery | null {
  if (typeof rawSql !== 'string' || rawSql.length === 0) return null;
  const { startOffset, endOffset } = locateQueryInYaml(yamlContent, rawSql, yamlPath);
  const query = parseQuery({
    rawSql,
    yamlPath,
    startOffset,
    endOffset,
    varsScope,
    dialect,
  });
  into.push(query);
  return query;
}
```

In `buildBatonDocument`, resolve the dialect once near the top (right after `parseYaml` returns a valid object, before any walking):

```ts
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

  // Resolve dialect once. undefined when scheme is missing or unsupported.
  const dialect = schemeToDialect(doc.connect?.scheme);

  // ... rest of buildBatonDocument unchanged in structure ...
```

Then update EVERY `buildQueryIfPresent(...)` call to pass `dialect` as the last argument. There are calls in these places (use a grep-replace pattern, but verify each one):
- list walk (after the list section)
- entitlements top-level query
- entitlements.map[i].provisioning.{grant,revoke}.queries[j] (inside the for-loop)
- grants[i].query
- static_entitlements[i].provisioning.{grant,revoke}.queries[j]
- account_provisioning.validate.query
- account_provisioning.create.queries[j]
- credential_rotation.update.queries[j]
- actions.<a>.query
- actions.<a>.queries[j]

Every call site appends `, dialect` to the argument list. Example transformations:

```ts
// Before
const query = buildQueryIfPresent(
  yamlContent, rtVal.list.query, [...listPath, 'query'], varsScope, doc.queries
);

// After
const query = buildQueryIfPresent(
  yamlContent, rtVal.list.query, [...listPath, 'query'], varsScope, doc.queries, dialect
);
```

Do this for every call site in `buildBatonDocument`.

**Verify with grep:** after the edit, run:
```bash
grep -c "buildQueryIfPresent" src/validation/document.ts
```

The number of calls should match the number of `dialect` arguments. Alternative verification:
```bash
grep "buildQueryIfPresent" src/validation/document.ts | grep -v ", dialect)" | grep -v "^function buildQueryIfPresent"
```
This should produce no output (every call passes `dialect`, except the definition itself).

- [ ] **Step 4: Run document tests, verify all pass** (30 prior + 5 new = 35)

```bash
node --import tsx --test src/validation/document.test.ts 2>&1 | tail -15
```

Expected: `pass 35`, `fail 0`.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 143` (138 + 5 new), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/validation/document.ts src/validation/document.test.ts
git commit -m "validation: thread connect.scheme dialect through buildBatonDocument

Each ParsedQuery built by buildBatonDocument now carries the dialect resolved
from connect.scheme via schemeToDialect. node-sql-parser parses with the
appropriate dialect, so postgres/mysql/sqlserver-specific syntax (ON CONFLICT,
RETURNING, TOP, etc.) no longer falls through to the rules' string fallbacks
when the user has correctly set connect.scheme."
```

---

## Task 4: Pipeline behavior-delta smoke test

**Files:**
- Modify: `src/validation/pipeline.test.ts`

This task adds a smoke test that demonstrates the behavior change: a postgres `ON CONFLICT` query no longer fails AST parsing when `connect.scheme=postgres`, which means rules that rely on `ast === null` to take their string-fallback path now correctly see the AST.

- [ ] **Step 1: Append the test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: postgres ON CONFLICT parses cleanly when connect.scheme=postgres', () => {
  // Behavior delta vs PR1: with connect.scheme=postgres, node-sql-parser
  // recognizes ON CONFLICT and the AST is populated. Rules with AST-then-
  // string-fallback paths now stay on the AST path.
  const yaml = `
app_name: t
connect:
  scheme: postgres
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT id, name FROM users
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: username, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password: { preferred: true }
      validate:
        query: "SELECT 1"
      create:
        queries:
          - "INSERT INTO users (id, name) VALUES (1, 'x') ON CONFLICT (id) DO UPDATE SET name = 'x'"
`;
  documentCache.clear();
  uriToHash.clear();
  const { document, results } = validateDocument(yaml);

  const conflictQ = document.queries.find(q => q.rawSql.includes('ON CONFLICT'));
  assert.ok(conflictQ, 'should locate the ON CONFLICT query');
  assert.equal(conflictQ!.dialect, 'postgresql');
  assert.notEqual(conflictQ!.ast, null, 'AST should be populated under postgresql dialect');
  assert.equal(conflictQ!.astError, null);

  // The connector itself accepts this ON CONFLICT shape, and our schema
  // mirrors that. The unconventional-sql-syntax rule recognizes DO UPDATE.
  // No rule should flag this query.
  const conflictDiagnostics = results.filter(r =>
    r.query?.rawSql.includes('ON CONFLICT')
  );
  assert.equal(conflictDiagnostics.length, 0, 'no diagnostics for valid ON CONFLICT');
});

test('pipeline: postgres ON CONFLICT without connect.scheme — AST still fails (default dialect)', () => {
  // Lock in the regression that motivates this PR: without a scheme, the
  // default (mysql) parser rejects ON CONFLICT, leaving ast=null and forcing
  // any consumer to use string-based fallback logic.
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT id, name FROM users
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: username, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password: { preferred: true }
      validate:
        query: "SELECT 1"
      create:
        queries:
          - "INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING"
`;
  documentCache.clear();
  uriToHash.clear();
  const { document } = validateDocument(yaml);
  const conflictQ = document.queries.find(q => q.rawSql.includes('ON CONFLICT'));
  assert.ok(conflictQ);
  assert.equal(conflictQ!.dialect, undefined);
  assert.equal(conflictQ!.ast, null);
  assert.ok(conflictQ!.astError, 'astError should be populated when parse fails');
});
```

- [ ] **Step 2: Run pipeline tests, verify 12 pass** (10 prior + 2 new)

```bash
node --import tsx --test src/validation/pipeline.test.ts 2>&1 | tail -15
```

Expected: `pass 12`, `fail 0`.

- [ ] **Step 3: Run full suite**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 145` (143 + 2 new), `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/validation/pipeline.test.ts
git commit -m "validation: pipeline smoke tests for dialect-aware parsing

Locks in the behavior delta: postgres ON CONFLICT queries parse cleanly when
connect.scheme=postgres, and remain unparsable (ast=null, astError set) when
no scheme is provided (default mysql dialect)."
```

---

## Task 5: Final integration verification + CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json` (version bump 1.4.0 → 1.5.0)

PR2 is a user-visible behavior change, so it warrants a minor version bump.

- [ ] **Step 1: Run the full suite, build, lint, audit**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 145`, `fail 0`.

```bash
npm run build 2>&1 | tail -3
```

Expected: clean (1 pre-existing webpack warning).

```bash
npm run lint 2>&1 | tail -3
```

Expected: 0 errors. Warning count similar to PR1's final state (~160).

```bash
npm audit 2>&1 | tail -3
```

Expected: 0 vulnerabilities.

- [ ] **Step 2: Bump version in `package.json`**

Find:
```json
  "version": "1.4.0",
```

Replace with:
```json
  "version": "1.5.0",
```

- [ ] **Step 3: Prepend CHANGELOG entry**

Insert this section directly under the `# Change Log` header line (before the existing `## [1.4.0]` section). The exact date should match `date '+%Y-%m-%d'`:

```markdown
## [1.5.0] - 2026-05-22

### Changed

- **Dialect-aware SQL parsing.** `connect.scheme` is now passed through to `node-sql-parser` as its `database` option. Postgres-specific syntax (e.g., `ON CONFLICT`, `RETURNING`, `::type` casts), SQL Server `TOP`, and other dialect-specific constructs now parse correctly instead of falling through to brittle string-based fallback code paths in the rules.

### Added

- New `src/validation/dialect.ts` exporting `schemeToDialect(scheme?)`. Maps `postgres`/`postgresql` → `postgresql`, `mysql`/`mariadb` → `mysql`, `sqlserver`/`mssql`/`tsql` → `transactsql`, plus `sqlite`, `snowflake`, `bigquery`, `redshift`, `db2`. Schemes the connector supports but `node-sql-parser` doesn't (`oracle`, `hdb`) fall back to the default dialect.
- `ParsedQuery.dialect` records the dialect used by the parse (undefined = default).

### Behavior deltas

Users who set `connect.scheme` may see fewer false-positive diagnostics on dialect-specific SQL. Users without `connect.scheme` see no change — the default parser dialect remains the same.

```

- [ ] **Step 4: Verify tests still pass**

```bash
npm test 2>&1 | tail -6
```

Expected: `pass 145`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "release: bump to v1.5.0 for dialect-aware parsing"
```

- [ ] **Step 6: Package**

```bash
rm -f baton-sql-extension-*.vsix && npm run package 2>&1 | tail -3
```

Expected: clean package at ~1.6 MB, `baton-sql-extension-1.5.0.vsix`.

---

## Self-review checklist

Before opening the PR, verify:

- [ ] All 14 existing rule files in `src/validation/rules/` are unchanged on disk (`git diff --stat main src/validation/rules/` empty).
- [ ] No file under `src/server/features/` was modified.
- [ ] `src/validation/types.ts`, `context.ts`, `sqlValidator.ts`, `pipeline.ts` are unchanged.
- [ ] All 124 PR1 tests pass plus the new ~21 PR2 tests = ~145 total.
- [ ] `npm run build` clean.
- [ ] `npm run lint` has 0 errors.
- [ ] `npm audit` clean.
- [ ] Version is 1.5.0.
- [ ] CHANGELOG has the 1.5.0 entry.

## PR description template

```
PR2: Dialect-aware parsing

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-22-pr2-dialect-aware-parsing.md

This is PR2 of 8 in the SQL validation foundation series. Behavior change:
the connector's `connect.scheme` value (postgres, mysql, sqlserver, etc.)
now reaches node-sql-parser, so dialect-specific syntax parses correctly.

What's added:
- src/validation/dialect.ts: schemeToDialect() mapping helper
- ParsedQuery.dialect field
- parseQuery passes { database } option to node-sql-parser's astify

What's modified:
- buildBatonDocument resolves dialect once from connect.scheme and threads
  it through every parseQuery call site.

Behavior deltas:
- Users with `connect.scheme: postgres` (or mysql/sqlserver/etc.) may see
  fewer false-positive diagnostics on dialect-specific SQL.
- Users without `connect.scheme` see no change.

What's NOT changed:
- Any rule file in src/validation/rules/
- Any LSP feature provider
- The JSON schema, snippets, or build config
```
