import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trailingCommaRule } from './trailingCommaRule';

const v = (sql: string) => trailingCommaRule.validate(sql, sql);

test('trailing-comma: clean SELECT is valid', () => {
  const sql = ['SELECT', '  id,', '  name', 'FROM users'].join('\n');
  assert.equal(v(sql).isValid, true);
});

test('trailing-comma: trailing comma before FROM is invalid', () => {
  const sql = ['SELECT', '  id,', '  name,', 'FROM users'].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /trailing comma/i);
});

test('trailing-comma: single-line SELECT with trailing comma before FROM is invalid', () => {
  const r = v('SELECT id, name, FROM users');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /trailing comma/i);
});

test('trailing-comma: trailing comma before WHERE is invalid', () => {
  const sql = ['SELECT', '  id,', '  name,', 'WHERE id = 1'].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /trailing comma/i);
});

test('trailing-comma: query with no commas is valid', () => {
  assert.equal(v('SELECT * FROM users').isValid, true);
});
