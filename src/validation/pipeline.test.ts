import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDocument,
  documentCache,
  uriToHash,
  evictUri,
} from './pipeline';

const SAMPLE_VALID = `
app_name: t
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT id, name
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;

const SAMPLE_INVALID_SQL = `
app_name: t
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT
          id,
          name
          email
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;

test('validateDocument: clean document produces no failures', () => {
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(SAMPLE_VALID);
  assert.equal(results.length, 0);
});

test('validateDocument: missing-comma in SELECT surfaces a failure', () => {
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(SAMPLE_INVALID_SQL);
  assert.ok(results.length > 0);
  const messages = results.map(r => r.result.errorMessage || '');
  assert.ok(messages.some(m => /missing comma/i.test(m)));
});

test('validateDocument: returns document alongside results', () => {
  documentCache.clear();
  const { document, results } = validateDocument(SAMPLE_VALID);
  assert.equal(document.queries.length, 1);
  assert.equal(document.resourceTypes.size, 1);
  assert.equal(results.length, 0);
});

test('validateDocument: invokes onRuleError when a rule throws', () => {
  documentCache.clear();
  const errors: string[] = [];
  // We use a YAML that will validate fine; the rule-throw scenario is exercised
  // by sqlValidator.test.ts via a fake throwing rule. Here we only assert that
  // the parameter is accepted and produces results.
  const { results } = validateDocument(SAMPLE_VALID, (rule, err) => {
    errors.push(`${rule}:${String(err)}`);
  });
  assert.ok(Array.isArray(results));
  assert.equal(errors.length, 0);
});

test('uriToHash + evictUri: removing an entry clears that hash from the cache', () => {
  documentCache.clear();
  uriToHash.clear();
  // Simulate a cached entry.
  documentCache.set('h1', []);
  uriToHash.set('file:///a.yaml', 'h1');
  evictUri('file:///a.yaml');
  assert.equal(uriToHash.has('file:///a.yaml'), false);
  assert.equal(documentCache.has('h1'), false);
});

test('uriToHash + evictUri: evicting a URI not in the side-index is a no-op', () => {
  documentCache.clear();
  uriToHash.clear();
  documentCache.set('h2', []);
  evictUri('file:///nonexistent.yaml');
  assert.equal(documentCache.has('h2'), true); // unchanged
});

test('cache: same content across two URIs reuses the cached diagnostics', () => {
  documentCache.clear();
  uriToHash.clear();
  documentCache.set('shared', [{ message: 'x' } as any]);
  uriToHash.set('file:///A.yaml', 'shared');
  uriToHash.set('file:///B.yaml', 'shared');

  evictUri('file:///A.yaml');
  assert.equal(uriToHash.has('file:///A.yaml'), false);
  assert.equal(uriToHash.get('file:///B.yaml'), 'shared');
  assert.equal(documentCache.has('shared'), true,
    'cache entry should survive when another URI still references the hash');

  evictUri('file:///B.yaml');
  assert.equal(documentCache.has('shared'), false);
});

test('pipeline smoke: SELECT with UNION subquery (v1.3.2 regression fixture)', () => {
  // No comma should be flagged — UNION inside subquery must not terminate outer SELECT.
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT
          u.id,
          u.name
        FROM users u
        WHERE u.id IN (
          SELECT user_id FROM admins
          UNION
          SELECT user_id FROM superusers
        )
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const missingComma = results.filter(r => /missing comma/i.test(r.result.errorMessage || ''));
  assert.equal(missingComma.length, 0, 'no missing-comma errors should be flagged');
});

test('pipeline smoke: INSERT with paren on own line (v1.3.1 regression fixture)', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1 FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
    account_provisioning:
      schema:
        - { name: username, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password: { preferred: true }
      validate:
        query: "SELECT 1"
      create:
        queries:
          - |
            INSERT INTO users (
              name,
              email,
              age
            ) VALUES (
              'alice',
              'a@b.com',
              30
            )
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const missingComma = results.filter(r => /missing comma/i.test(r.result.errorMessage || ''));
  assert.equal(missingComma.length, 0);
});

test('pipeline smoke: a real broken query produces missing-comma diagnostics', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT
          id,
          name
          email
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(yaml);
  const missingComma = results.filter(r => /missing comma/i.test(r.result.errorMessage || ''));
  assert.ok(missingComma.length > 0, 'should flag the missing comma between name and email');
});

test('pipeline smoke: degraded doc (invalid YAML) emits no rule diagnostics', () => {
  documentCache.clear();
  const { results } = validateDocument(': : : :');
  assert.equal(results.length, 0);
});

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
    /not defined/i.test(r.result.errorMessage || '')
  );
  assert.ok(matching.length > 0, 'varsQueryMismatchRule should fire for the undefined param (undefined-first priority)');
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
