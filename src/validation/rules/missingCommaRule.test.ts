import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingCommaRule } from './missingCommaRule';

const v = (sql: string) => missingCommaRule.validate(sql, sql);

test('missing-comma: SELECT with commas is valid', () => {
  const sql = ['SELECT', '  id,', '  name,', '  email', 'FROM users'].join('\n');
  assert.equal(v(sql).isValid, true);
});

test('missing-comma: SELECT missing a comma between columns is invalid', () => {
  const sql = ['SELECT', '  id,', '  name', '  email,', 'FROM users'].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /missing comma/i);
});

test('missing-comma: single-line SELECT does not false-positive', () => {
  assert.equal(v('SELECT id, name FROM users').isValid, true);
});

test('missing-comma: INSERT column list with each column on own line is valid', () => {
  // Regression: v1.3.1 — opening paren on its own line was flagged as needing a comma.
  const sql = [
    'INSERT INTO users (',
    '  name,',
    '  email,',
    '  age',
    ') VALUES (',
    "  'alice',",
    "  'a@b.com',",
    '  30',
    ')'
  ].join('\n');
  assert.equal(v(sql).isValid, true);
});

test('missing-comma: INSERT column list missing comma is invalid', () => {
  const sql = [
    'INSERT INTO users (',
    '  name',
    '  email,',
    '  age',
    ') VALUES (1, 2, 3)'
  ].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /missing comma/i);
});

test('missing-comma: SELECT with UNION inside a subquery does not false-positive', () => {
  // Regression: v1.3.2 — UNION inside a subquery in a JOIN was treated as ending
  // the outer SELECT, causing a false missing-comma flag on the prior column.
  const sql = [
    'SELECT',
    '  u.id,',
    '  u.name',
    'FROM users u',
    'WHERE u.id IN (',
    '  SELECT user_id FROM admins',
    '  UNION',
    '  SELECT user_id FROM superusers',
    ')'
  ].join('\n');
  assert.equal(v(sql).isValid, true);
});

test('missing-comma: UPDATE SET with proper commas is valid', () => {
  const sql = [
    'UPDATE users',
    'SET',
    "  name = 'alice',",
    "  email = 'a@b.com'",
    'WHERE id = 1'
  ].join('\n');
  assert.equal(v(sql).isValid, true);
});

test('missing-comma: UPDATE SET missing comma between assignments is invalid', () => {
  const sql = [
    'UPDATE users',
    'SET',
    "  name = 'alice'",
    "  email = 'a@b.com'",
    'WHERE id = 1'
  ].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /missing comma/i);
});

test('missing-comma: SELECT with CASE expression does not false-positive', () => {
  const sql = [
    'SELECT',
    '  id,',
    '  CASE',
    "    WHEN status = 'active' THEN 1",
    '    ELSE 0',
    '  END AS active_flag,',
    '  name',
    'FROM users'
  ].join('\n');
  assert.equal(v(sql).isValid, true);
});
