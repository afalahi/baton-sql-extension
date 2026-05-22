import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unconventionalSqlSyntaxRule } from './unconventionalSqlSyntaxRule';

const v = (sql: string) => unconventionalSqlSyntaxRule.validate(sql, sql);

test('unconventional-sql: ON CONFLICT DO NOTHING is valid', () => {
  const sql = 'INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING';
  assert.equal(v(sql).isValid, true);
});

test('unconventional-sql: ON CONFLICT DO UPDATE is valid', () => {
  const sql = "INSERT INTO users (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET name = 'x'";
  assert.equal(v(sql).isValid, true);
});

test('unconventional-sql: bare ON CONFLICT is invalid', () => {
  const sql = 'INSERT INTO users (id) VALUES (1) ON CONFLICT';
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /ON CONFLICT|DO NOTHING|DO UPDATE/i);
});

test('unconventional-sql: trailing RETURNING with no columns is invalid', () => {
  const sql = 'INSERT INTO users (id) VALUES (1) RETURNING';
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /RETURNING/i);
});

test('unconventional-sql: RETURNING with columns is valid', () => {
  const sql = 'INSERT INTO users (id) VALUES (1) RETURNING id, name';
  assert.equal(v(sql).isValid, true);
});

test('unconventional-sql: gen_salt() without algorithm is invalid', () => {
  const sql = "SELECT crypt('x', gen_salt()) FROM dual";
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /gen_salt|algorithm/i);
});

test('unconventional-sql: gen_salt with bf algorithm is valid', () => {
  const sql = "SELECT crypt('x', gen_salt('bf')) FROM dual";
  assert.equal(v(sql).isValid, true);
});

test('unconventional-sql: crypt with single argument is invalid', () => {
  const sql = "SELECT crypt('x') FROM dual";
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /crypt|2 arguments/i);
});

test('unconventional-sql: DATE literal with non-ISO format is invalid', () => {
  const sql = "SELECT * FROM events WHERE d > DATE 'tomorrow'";
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /DATE|YYYY-MM-DD/i);
});

test('unconventional-sql: DATE literal in ISO format is valid', () => {
  const sql = "SELECT * FROM events WHERE d > DATE '2025-01-01'";
  assert.equal(v(sql).isValid, true);
});

test('unconventional-sql: plain SELECT has no false positives', () => {
  assert.equal(v('SELECT id, name FROM users').isValid, true);
});
