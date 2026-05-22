import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordSpellingRule } from './keywordSpellingRule';

const v = (sql: string) => keywordSpellingRule.validate(sql, sql);

test('keyword-spelling: correctly spelled multi-line query is valid', () => {
  const sql = ['SELECT id, name', 'FROM users', 'WHERE active = 1'].join('\n');
  assert.equal(v(sql).isValid, true);
});

test('keyword-spelling: misspelled SELECT is flagged with suggested fix', () => {
  const sql = ['SELCT id, name', 'FROM users'].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /SELECT/i);
  assert.equal(r.suggestedFix?.newText, 'SELECT');
});

test('keyword-spelling: misspelled FROM is flagged', () => {
  const sql = ['SELECT id', 'FORM users'].join('\n');
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /FROM/i);
});

test('keyword-spelling: single-line queries are not checked (by design)', () => {
  // Rule only runs on multi-line queries to avoid false positives on YAML keys.
  assert.equal(v('SELCT id FROM users').isValid, true);
});

test('keyword-spelling: YAML-key-only lines like "group:" are ignored', () => {
  // Regression guard: resource-type keys like "group:" must not be flagged.
  const sql = ['group:', '  list:', '    query: SELECT id FROM groups'].join('\n');
  assert.equal(v(sql).isValid, true);
});
