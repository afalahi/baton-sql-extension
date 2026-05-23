import { test } from 'node:test';
import assert from 'node:assert/strict';
import { principalTypeReferenceRule } from './principalTypeReferenceRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = principalTypeReferenceRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('principal-type-reference: literal that matches a known resource type is valid', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: user
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('principal-type-reference: expression-style value is skipped', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: ".type"
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('principal-type-reference: literal "useer" (typo) is rejected with did-you-mean', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: useer
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /useer/);
  assert.match(results[0].errorMessage || '', /Did you mean.*user/i);
});

test('principal-type-reference: literal with no close match flags without suggestion', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".user_id"
            principal_type: department
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /department/);
  assert.match(results[0].errorMessage || '', /not a defined resource_type/i);
});

test('principal-type-reference: multiple offending mappings produce multiple diagnostics', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u1"
            principal_type: useer
            entitlement_id: ".perm"
          - principal_id: ".u2"
            principal_type: gruop
            entitlement_id: ".perm"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
});
