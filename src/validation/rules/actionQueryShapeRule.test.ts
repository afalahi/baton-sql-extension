import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionQueryShapeRule } from './actionQueryShapeRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = actionQueryShapeRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const ACTION_BASE = `
app_name: test
connect:
  dsn: postgres://x
resource_types: {}
`;

test('action-query-shape: only query is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('action-query-shape: only queries (array) is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    queries:
      - "UPDATE users SET disabled = true WHERE id = ?<user_id>"
      - "INSERT INTO audit (action) VALUES ('disable')"
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('action-query-shape: both query AND queries is rejected', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    queries:
      - "INSERT INTO audit (action) VALUES ('disable')"
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /disable_user/);
  assert.match(results[0].errorMessage || '', /exactly one|both/i);
});

test('action-query-shape: neither query nor queries is rejected', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    arguments:
      user_id:
        name: User ID
        type: string
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /disable_user/);
  assert.match(results[0].errorMessage || '', /must specify|query.*queries/i);
});

test('action-query-shape: multiple actions, each checked independently', () => {
  const yaml = ACTION_BASE + `
actions:
  good_action:
    name: Good
    query: "UPDATE x SET y = 1"
  both_set:
    name: Both
    query: "UPDATE x SET y = 1"
    queries:
      - "UPDATE z SET w = 1"
  neither_set:
    name: Neither
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
  const messages = results.map(r => r.errorMessage || '');
  assert.ok(messages.some(m => /both_set/.test(m)));
  assert.ok(messages.some(m => /neither_set/.test(m)));
});
