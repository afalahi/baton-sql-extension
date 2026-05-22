import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambiguousColumnsRule } from './ambiguousColumnsRule';

const v = (sql: string) => ambiguousColumnsRule.validate(sql, sql);

test('ambiguous-columns: SELECT * on a single table is valid', () => {
  assert.equal(v('SELECT * FROM users').isValid, true);
});

test('ambiguous-columns: explicit columns with multiple tables is valid', () => {
  const sql = 'SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id';
  assert.equal(v(sql).isValid, true);
});

test('ambiguous-columns: SELECT * across multiple tables is invalid', () => {
  const sql = 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id';
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /ambiguous|\*/i);
});

test('ambiguous-columns: table-qualified * on a single table in multi-table query is valid', () => {
  const sql = 'SELECT u.*, o.total FROM users u JOIN orders o ON u.id = o.user_id';
  assert.equal(v(sql).isValid, true);
});
