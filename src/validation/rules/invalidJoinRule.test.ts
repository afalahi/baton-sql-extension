import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidJoinRule } from './invalidJoinRule';

const v = (sql: string) => invalidJoinRule.validate(sql, sql);

test('invalid-join: JOIN with ON clause is valid', () => {
  const sql = 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id';
  assert.equal(v(sql).isValid, true);
});

test('invalid-join: LEFT JOIN with ON clause is valid', () => {
  const sql = 'SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id';
  assert.equal(v(sql).isValid, true);
});

test('invalid-join: JOIN without ON clause is invalid', () => {
  // String-based fallback path: AST may also flag this.
  const sql = ['SELECT *', 'FROM users u', 'JOIN orders o', 'WHERE u.id = 1'].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /on/i);
});

test('invalid-join: CROSS JOIN without ON is valid (cross join has no ON requirement)', () => {
  const sql = 'SELECT * FROM users u CROSS JOIN regions r';
  assert.equal(v(sql).isValid, true);
});

test('invalid-join: query without JOINs is valid', () => {
  assert.equal(v('SELECT id FROM users').isValid, true);
});
