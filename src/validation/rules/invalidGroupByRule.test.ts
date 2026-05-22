import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidGroupByRule } from './invalidGroupByRule';

const v = (sql: string) => invalidGroupByRule.validate(sql, sql);

test('invalid-group-by: pure aggregate query without GROUP BY is valid', () => {
  assert.equal(v('SELECT COUNT(*) FROM users').isValid, true);
});

test('invalid-group-by: aggregate + non-aggregate with GROUP BY is valid', () => {
  assert.equal(v('SELECT dept, COUNT(*) FROM employees GROUP BY dept').isValid, true);
});

test('invalid-group-by: aggregate mixed with non-aggregate but no GROUP BY is invalid', () => {
  const r = v('SELECT dept, COUNT(*) FROM employees');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /group by/i);
});

test('invalid-group-by: query with no aggregates is valid', () => {
  assert.equal(v('SELECT id, name FROM users').isValid, true);
});
