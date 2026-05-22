import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingFromRule } from './missingFromRule';

const v = (sql: string) => missingFromRule.validate(sql, sql);

test('missing-from: SELECT with FROM clause is valid', () => {
  assert.equal(v('SELECT id, name FROM users').isValid, true);
});

test('missing-from: SELECT of a literal does not require FROM', () => {
  assert.equal(v('SELECT 1').isValid, true);
  assert.equal(v("SELECT 'hello'").isValid, true);
});

test('missing-from: SELECT of system function does not require FROM', () => {
  assert.equal(v('SELECT NOW()').isValid, true);
  assert.equal(v('SELECT CURRENT_TIMESTAMP').isValid, true);
});

test('missing-from: SELECT of a bare identifier without FROM is invalid', () => {
  const r = v('SELECT id, name');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /missing from/i);
});

test('missing-from: non-SELECT statements are ignored', () => {
  assert.equal(v('INSERT INTO users (id) VALUES (1)').isValid, true);
  assert.equal(v("UPDATE users SET name='x' WHERE id=1").isValid, true);
});
