import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getParser, extractSelectColumns } from './sqlUtils';

function parse(sql: string): any {
  return getParser().astify(sql);
}

test('extractSelectColumns: null AST returns empty + no wildcard', () => {
  const result = extractSelectColumns(null);
  assert.equal(result.columns.size, 0);
  assert.equal(result.hasWildcard, false);
});

test('extractSelectColumns: plain SELECT lists column names', () => {
  const result = extractSelectColumns(parse('SELECT login, email FROM users'));
  assert.deepEqual([...result.columns].sort(), ['email', 'login']);
  assert.equal(result.hasWildcard, false);
});

test('extractSelectColumns: SELECT * sets hasWildcard', () => {
  const result = extractSelectColumns(parse('SELECT * FROM users'));
  assert.equal(result.hasWildcard, true);
});

test('extractSelectColumns: alias takes precedence over column name', () => {
  const result = extractSelectColumns(parse('SELECT login AS l, email FROM users'));
  assert.deepEqual([...result.columns].sort(), ['email', 'l']);
});

test('extractSelectColumns: qualified column uses base name', () => {
  const result = extractSelectColumns(parse('SELECT u.login, u.email AS e FROM users u'));
  assert.deepEqual([...result.columns].sort(), ['e', 'login']);
});

test('extractSelectColumns: function call with alias uses alias', () => {
  const result = extractSelectColumns(parse('SELECT COUNT(*) AS total FROM users'));
  assert.deepEqual([...result.columns], ['total']);
  assert.equal(result.hasWildcard, false);
});
