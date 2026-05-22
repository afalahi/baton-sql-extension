import { test } from 'node:test';
import assert from 'node:assert/strict';
import { varsQueryMismatchRule } from './varsQueryMismatchRule';

// The rule scans its `sql` arg for `?<param>` patterns and its `originalQuery`
// arg for a vars: block. The production orchestrator normalizes `?<param>` out
// of the SQL before invoking rules, so this rule effectively no-ops there.
// These tests exercise the rule's logic directly.

test('vars-query-mismatch: vars match query params -> valid', () => {
  const yaml = ['vars:', '  user_id: resource.ID', 'query: |', '  SELECT * FROM users WHERE id = ?<user_id>'].join('\n');
  const sql = 'SELECT * FROM users WHERE id = ?<user_id>';
  assert.equal(varsQueryMismatchRule.validate(sql, yaml).isValid, true);
});

test('vars-query-mismatch: query uses param not defined in vars -> invalid', () => {
  // Use a vars block whose only entry IS the one used in the query, so neither
  // an "unused" nor any other case applies. Then add an EXTRA used param that
  // isn't in vars — this should be reported as undefined.
  const yaml = [
    'vars:',
    '  user_id: resource.ID',
    'query: |',
    '  SELECT * FROM users WHERE id = ?<user_id> AND tenant = ?<tenant_id>'
  ].join('\n');
  const sql = 'SELECT * FROM users WHERE id = ?<user_id> AND tenant = ?<tenant_id>';
  const r = varsQueryMismatchRule.validate(sql, yaml);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /not defined|tenant_id/i);
});

test('vars-query-mismatch: vars defines unused variable -> invalid', () => {
  const yaml = [
    'vars:',
    '  unused_var: foo',
    '  user_id: resource.ID',
    'query: |',
    '  SELECT * FROM users WHERE id = ?<user_id>'
  ].join('\n');
  const sql = 'SELECT * FROM users WHERE id = ?<user_id>';
  const r = varsQueryMismatchRule.validate(sql, yaml);
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /not used|unused_var/i);
});

test('vars-query-mismatch: no params in query -> rule does not apply', () => {
  assert.equal(varsQueryMismatchRule.validate('SELECT * FROM users', 'app_name: x').isValid, true);
});
