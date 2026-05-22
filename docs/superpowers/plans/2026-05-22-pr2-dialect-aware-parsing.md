# Dialect-Aware Parsing (PR2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass `connect.scheme` from the YAML through to `node-sql-parser` so postgres/mysql/sqlserver-specific SQL parses correctly instead of falling through to brittle string-based code paths in the rules.

**Architecture:** Add a new `schemeToDialect` helper that maps user-facing scheme names (`postgres`, `mysql`, `sqlserver`, `oracle`, `hdb`, …) to `node-sql-parser`'s `database` option (`'postgresql'`, `'mysql'`, `'transactsql'`, undefined for unsupported). Plumb the resulting dialect through `ParseQueryInput` → `parseQuery` → `parser.astify(sql, { database })`. `buildBatonDocument` reads `connect.scheme` once and passes the resolved dialect to every `buildQueryIfPresent` call.

**Tech Stack:** TypeScript 4.x strict, `node-sql-parser` 5.3.9 (supports `mysql` (default), `postgresql`, `transactsql`, `mariadb`, `bigquery`, `snowflake`, `sqlite`, etc. via the `database` option), node:test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md` (Rollout, "PR2 — Dialect-aware parsing").

**Behavior delta:** SQL that the default (`mysql`) parser previously rejected now parses successfully when `connect.scheme` is set, which means `ParsedQuery.ast` is now populated for dialect-specific SQL where it was previously `null`. **In practice, this PR's user-visible diagnostic delta on the current rule set is likely zero** — most current rules either don't apply to dialect-specific shapes (e.g., AST-driven rules only fire on SELECT, while postgres `ON CONFLICT` / `RETURNING` are in INSERT/UPDATE/DELETE) or take string-based paths that don't depend on the AST. PR2's real value is **foundational**: PR3+ rules can rely on AST being populated for dialect-specific SQL, and PR7's column-trait coherence checker specifically needs this. The "zero behavior change" guarantee from PR1 strictly ends here (AST state is observably different), but in terms of LSP diagnostics emitted, expect this PR to be effectively invisible to users until later PRs add rules that exploit the now-correct AST.

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

**Tests after PR2:** 124 → ~145 (10 + 4 + 5 + 2 new = 21).

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
  assert.equal(schemeToDialect('pg'), 'postgresql');
  assert.equal(schemeToDialect('PostgreSQL'), 'postgresql');
  assert.equal(schemeToDialect('POSTGRES'), 'postgresql');
});

test('schemeToDialect: mysql variants → mysql', () => {
  assert.equal(schemeToDialect('mysql'), 'mysql');
  assert.equal(schemeToDialect('mysql2'), 'mysql');
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
    case 'pg':
    case 'postgres':
    case 'postgresql':
      return 'postgresql';
    case 'mysql':
    case 'mysql2':
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
    // node-sql-parser accepts opt=undefined as "use default dialect" — no need to branch.
    const options = input.dialect ? { database: input.dialect } : undefined;
    ast = getParser().astify(normalizedSql, options);
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
    assert.equal(q.dialect, 'postgresql', `yamlPath=${JSON.stringify(q.yamlPath)} should be postgresql`);
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

**Verify with these two counts:**

```bash
# Count call sites (excluding the definition).
grep -c "buildQueryIfPresent(" src/validation/document.ts
```

Then count occurrences of `dialect,` (the trailing argument, with the comma) inside the file:

```bash
grep -c "^[[:space:]]*dialect," src/validation/document.ts
```

The two counts should match. If they don't, a `buildQueryIfPresent` call is missing the `dialect` argument — spot-check each call manually using:

```bash
awk '/buildQueryIfPresent\(/,/\);/' src/validation/document.ts
```

This prints each call, multi-line and all, so you can visually verify every one ends with `dialect`. The definition itself (one line further down) will also appear in this output — that's expected; it's the function being called, not a call site.

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

## Task 4: Pipeline parse-state smoke tests

**Files:**
- Modify: `src/validation/pipeline.test.ts`

These tests verify the **parse-state invariant** that PR2 establishes: a postgres `ON CONFLICT` query has `ast` populated when `connect.scheme=postgres`, and `ast=null` when no scheme is provided. They do **not** assert a diagnostic delta — none of the current rules emit different diagnostics on the test fixture, because (a) AST-driven rules only check SELECT and the fixture is an INSERT, and (b) `unconventionalSqlSyntaxRule` accepts the `ON CONFLICT … DO UPDATE` shape via regex regardless of dialect. PR3+ rules that opt into `ctx.query.ast` will be where these parse-state invariants finally translate into visible improvements.

- [ ] **Step 1: Append the test** to `src/validation/pipeline.test.ts`:

```ts
test('pipeline: postgres ON CONFLICT has ast populated when connect.scheme=postgres', () => {
  // PR2 invariant: with connect.scheme=postgres, node-sql-parser recognizes
  // ON CONFLICT and ParsedQuery.ast is non-null. PR3+ rules can rely on this.
  // The test asserts AST/dialect state, NOT a diagnostic delta — the current
  // rule set produces the same diagnostics here either way (see test comment
  // below for why).
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

  // No current rule should flag this query. (Note: this assertion holds in
  // PR1 too — see the task narrative above.) The point of this test is to
  // lock in the AST-populated invariant above, not to demonstrate a
  // diagnostic delta.
  const conflictDiagnostics = results.filter(r =>
    r.query?.rawSql.includes('ON CONFLICT')
  );
  assert.equal(conflictDiagnostics.length, 0, 'no diagnostics for valid ON CONFLICT');
});

test('pipeline: postgres ON CONFLICT without connect.scheme — AST is null (default dialect)', () => {
  // PR2 invariant in the negative direction: without a scheme, the default
  // (mysql) parser rejects ON CONFLICT, leaving ast=null. This is the same
  // pre-PR2 behavior; the test exists so a future regression (e.g., switching
  // the default to postgresql) is caught.
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

- **Dialect-aware SQL parsing.** `connect.scheme` is now passed through to `node-sql-parser` as its `database` option. Postgres-specific syntax (e.g., `ON CONFLICT`, `RETURNING`, `::type` casts), SQL Server `TOP`, and other dialect-specific constructs now parse correctly. `ParsedQuery.ast` is populated for these queries where it was previously `null`.

### Added

- New `src/validation/dialect.ts` exporting `schemeToDialect(scheme?)`. Recognized schemes: `pg`/`postgres`/`postgresql` → `postgresql`; `mysql`/`mysql2`/`mariadb` → `mysql`; `sqlserver`/`mssql`/`tsql` → `transactsql`; plus `sqlite`, `snowflake`, `bigquery`, `redshift`, `db2`. Schemes the connector supports but `node-sql-parser` doesn't (`oracle`, `hdb`) fall back to the default dialect.
- `ParsedQuery.dialect` records the dialect used by the parse (undefined = default).

### Behavior deltas

This release is **foundational** — the current rule set does not produce visibly different LSP diagnostics in PR2. AST-driven rules only fire on SELECT, while the dialect-specific constructs that newly parse correctly are mostly in INSERT/UPDATE/DELETE shapes. The visible improvements will come in subsequent releases as new rules opt into the now-correct AST (e.g., dialect-specific column extraction for column-trait coherence). Users without `connect.scheme` see no change in this release.

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
PR2: Dialect-aware parsing (foundational, no visible diagnostic delta)

Spec: docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
Plan: docs/superpowers/plans/2026-05-22-pr2-dialect-aware-parsing.md

This is PR2 of 8 in the SQL validation foundation series. `connect.scheme`
now reaches node-sql-parser as its `database` option, so dialect-specific
SQL (postgres `ON CONFLICT`, SQL Server `TOP`, etc.) parses correctly
instead of leaving ParsedQuery.ast null.

What's added:
- src/validation/dialect.ts: schemeToDialect() mapping helper
- ParsedQuery.dialect field
- parseQuery passes { database } option to node-sql-parser's astify

What's modified:
- buildBatonDocument resolves dialect once from connect.scheme and threads
  it through every parseQuery call site.

Important — about behavior deltas:
- The current rule set does NOT emit different LSP diagnostics in this PR.
  AST-driven rules only fire on SELECT; the dialect-specific shapes that
  newly parse correctly are mostly in INSERT/UPDATE/DELETE. The visible
  improvements arrive when PR3+ rules opt into the now-correct AST.
- The PR is a precondition for PR7 (column-trait coherence), which extracts
  columns from CEL expressions — those expressions live in the AST.
- Users without connect.scheme see no change.

What's NOT changed:
- Any rule file in src/validation/rules/
- Any LSP feature provider
- The JSON schema, snippets, or build config
```
