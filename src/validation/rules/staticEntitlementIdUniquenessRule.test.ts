import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticEntitlementIdUniquenessRule } from './staticEntitlementIdUniquenessRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = staticEntitlementIdUniquenessRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('static-entitlement-uniqueness: unique IDs are valid', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Member
        description: m
        purpose: permission
        grantable_to: [user]
      - id: admin
        display_name: Admin
        description: a
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('static-entitlement-uniqueness: empty static_entitlements is valid', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('static-entitlement-uniqueness: duplicate IDs within one RT → diagnostic per duplicate', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Member1
        description: m
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member2
        description: m
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  // One diagnostic flagging the second 'member' as duplicate.
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /member/);
  assert.match(results[0].errorMessage || '', /duplicate/i);
});

test('static-entitlement-uniqueness: same ID across different RTs is valid (per-RT scope)', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Group Member
        description: m
        purpose: permission
        grantable_to: [user]
  role:
    name: Role
    description: r
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Role Member
        description: m
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('static-entitlement-uniqueness: triple duplicate produces two diagnostics', () => {
  const yaml = BASE + `
resource_types:
  group:
    name: Group
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: member
        display_name: Member1
        description: m
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member2
        description: m
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member3
        description: m
        purpose: permission
        grantable_to: [user]
`;
  const results = run(yaml).filter(r => !r.isValid);
  // Two diagnostics — one per duplicate after the first occurrence.
  assert.equal(results.length, 2);
});
