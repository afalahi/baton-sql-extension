import { test } from 'node:test';
import assert from 'node:assert/strict';
import { varsQueryMismatchRule } from './varsQueryMismatchRule';
import { parseQuery } from '../parsedQuery';
import type { BatonDocument } from '../document';

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

test('vars-query-mismatch: vars match query params -> valid', () => {
  const yaml = ['vars:', '  user_id: resource.ID', 'query: |', '  SELECT * FROM users WHERE id = ?<user_id>'].join('\n');
  const sql = 'SELECT * FROM users WHERE id = ?<user_id>';
  assert.equal(varsQueryMismatchRule.validate(sql, yaml).isValid, true);
});

test('vars-query-mismatch: query uses param not defined in vars -> invalid', () => {
  // Use a vars block whose only entry IS the one used in the query, so neither
  // an "unused" nor any other case applies. Then add an EXTRA used param that
  // isn't in vars — this should be reported as undefined.
  const yaml = [
    'vars:',
    '  user_id: resource.ID',
    'query: |',
    '  SELECT * FROM users WHERE id = ?<user_id> AND tenant = ?<tenant_id>'
  ].join('\n');
  const sql = 'SELECT * FROM users WHERE id = ?<user_id> AND tenant = ?<tenant_id>';
  const r = varsQueryMismatchRule.validate(sql, yaml);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /not defined|tenant_id/i);
});

test('vars-query-mismatch: vars defines unused variable -> invalid', () => {
  const yaml = [
    'vars:',
    '  unused_var: foo',
    '  user_id: resource.ID',
    'query: |',
    '  SELECT * FROM users WHERE id = ?<user_id>'
  ].join('\n');
  const sql = 'SELECT * FROM users WHERE id = ?<user_id>';
  const r = varsQueryMismatchRule.validate(sql, yaml);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /not used|unused_var/i);
});

test('vars-query-mismatch: no params in query -> rule does not apply', () => {
  assert.equal(varsQueryMismatchRule.validate('SELECT * FROM users', 'app_name: x').isValid, true);
});

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
