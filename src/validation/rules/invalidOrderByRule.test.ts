import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidOrderByRule } from './invalidOrderByRule';

const v = (sql: string) => invalidOrderByRule.validate(sql, sql);

test('invalid-order-by: ORDER BY column name is valid', () => {
  assert.equal(v('SELECT id, name FROM users ORDER BY name').isValid, true);
});

test('invalid-order-by: ORDER BY with ASC/DESC modifier is valid', () => {
  assert.equal(v('SELECT id FROM users ORDER BY id DESC').isValid, true);
});

test('invalid-order-by: ORDER BY position number is invalid', () => {
  const r = v('SELECT id, name FROM users ORDER BY 1');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /position/i);
});

test('invalid-order-by: query with no ORDER BY is valid', () => {
  assert.equal(v('SELECT id FROM users').isValid, true);
});
