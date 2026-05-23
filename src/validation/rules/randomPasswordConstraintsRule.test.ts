import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomPasswordConstraintsRule } from './randomPasswordConstraintsRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = randomPasswordConstraintsRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

test('random-password-constraints: well-formed constraints are valid', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: u, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password:
          preferred: true
          constraints:
            - { char_set: "abc", min_count: 1 }
            - { char_set: "0123456789", min_count: 2 }
      validate:
        query: SELECT 1
      create:
        queries: [ "INSERT INTO users (id) VALUES (1)" ]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('random-password-constraints: no random_password block is valid (no-op)', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('random-password-constraints: empty char_set is rejected', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: u, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password:
          preferred: true
          constraints:
            - { char_set: "", min_count: 2 }
      validate:
        query: SELECT 1
      create:
        queries: [ "INSERT INTO users (id) VALUES (1)" ]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /char_set/);
  assert.match(results[0].errorMessage || '', /empty|non-empty/i);
});

test('random-password-constraints: min_count <= 0 is rejected', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: u, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password:
          preferred: true
          constraints:
            - { char_set: "abc", min_count: 0 }
      validate:
        query: SELECT 1
      create:
        queries: [ "INSERT INTO users (id) VALUES (1)" ]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /min_count/);
  assert.match(results[0].errorMessage || '', /greater than zero|> 0/);
});
