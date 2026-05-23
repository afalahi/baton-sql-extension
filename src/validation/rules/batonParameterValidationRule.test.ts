import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batonParameterValidationRule } from './batonParameterValidationRule';
import { parseQuery } from '../parsedQuery';
import type { BatonDocument } from '../document';

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
const v = (sql: string) => batonParameterValidationRule.validate(sql, sql);

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

test('baton-parameter: valid parameter name is accepted', () => {
  assert.equal(v('SELECT * FROM users WHERE id = ?<user_id>').isValid, true);
});

test('baton-parameter: SQL without parameters is accepted', () => {
  assert.equal(v('SELECT * FROM users WHERE id = 1').isValid, true);
});

test('baton-parameter: parameter named after a SQL keyword is rejected', () => {
  const r = v('SELECT * FROM t WHERE x = ?<select>');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /SQL keyword/i);
});

test('baton-parameter: too-short parameter name is rejected', () => {
  const r = v('SELECT * FROM t WHERE x = ?<a>');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /short/i);
});

test('baton-parameter: invalid characters in name are rejected', () => {
  const r = v('SELECT * FROM t WHERE x = ?<user-id>');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /Invalid|letters|underscores/i);
});

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
