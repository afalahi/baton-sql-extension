import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionArgumentDefaultRule } from './actionArgumentDefaultRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = actionArgumentDefaultRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const ACTION_BASE = `
app_name: test
connect:
  dsn: postgres://x
resource_types: {}
`;

test('arg-required-default: required=true with no default is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
        required: true
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('arg-required-default: default set with required=false is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      reason:
        name: Reason
        type: string
        required: false
        default: "no reason given"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('arg-required-default: default set with required omitted is valid', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      reason:
        name: Reason
        type: string
        default: "no reason given"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('arg-required-default: required=true with default is rejected', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
        required: true
        default: "anonymous"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /user_id/);
  assert.match(results[0].errorMessage || '', /required.*default|default.*required/i);
});

test('arg-required-default: multiple offending args produce multiple diagnostics', () => {
  const yaml = ACTION_BASE + `
actions:
  disable_user:
    name: Disable user
    query: "UPDATE users SET disabled = true WHERE id = ?<user_id>"
    arguments:
      user_id:
        name: User ID
        type: string
        required: true
        default: "anonymous"
      reason:
        name: Reason
        type: string
        required: true
        default: "no reason"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
});
