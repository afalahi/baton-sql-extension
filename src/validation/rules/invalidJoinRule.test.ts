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

test('invalid-join: string-fallback does not false-positive on JOIN table alias ON ... when AST fails', () => {
  // Regression: a trailing comma before FROM makes the AST parser bail; the
  // string-based fallback then misread `JOIN t a ON t.x = a.y` as missing ON
  // because hasTableNameInLine's regex only handled `JOIN table` or
  // `JOIN table alias` (two identifiers before ON), not the three-identifier
  // `JOIN table alias ON ...` shape. Same-line ON check is now the first
  // path and doesn't gate on the table-name heuristic.
  const sql = [
    'SELECT',
    '  u.id AS user_id,',
    '  r.id AS role_id,',
    'FROM user_roles ur',
    'JOIN users u ON u.id = ur.user_id',
    'JOIN roles r ON r.id = ur.role_id',
    'WHERE ur.role_id = ?',
  ].join('\n');
  // Both args identical mirrors how tests exercise the rule directly. The
  // trailing comma after `role_id,` will cause the AST parse to fail.
  const result = invalidJoinRule.validate(sql, sql);
  assert.equal(result.isValid, true, `false-positive: ${result.errorMessage}`);
});
