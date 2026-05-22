import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAliasesRule } from './duplicateAliasesRule';

const v = (sql: string) => duplicateAliasesRule.validate(sql, sql);

test('duplicate-aliases: distinct aliases are valid', () => {
  const sql = 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id';
  assert.equal(v(sql).isValid, true);
});

test('duplicate-aliases: duplicate aliases across FROM and JOIN are invalid', () => {
  const sql = 'SELECT * FROM users u JOIN orders u ON u.id = u.user_id';
  const r = v(sql);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /duplicate.*alias|alias/i);
});

test('duplicate-aliases: no aliases is valid', () => {
  assert.equal(v('SELECT id FROM users').isValid, true);
});
