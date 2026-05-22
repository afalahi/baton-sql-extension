import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batonParameterValidationRule } from './batonParameterValidationRule';

// Note: this rule's regex looks for `?<param>` in its `sql` argument. The production
// orchestrator (validateSql) normalizes those out before invoking rules, so in
// production this rule effectively no-ops. These tests exercise the rule's logic
// directly by passing un-normalized SQL.
const v = (sql: string) => batonParameterValidationRule.validate(sql, sql);

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
