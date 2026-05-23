import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitlementIdReferenceRule } from './entitlementIdReferenceRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = entitlementIdReferenceRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('entitlement-id-reference: literal that matches a static_entitlements id is valid', () => {
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
    static_entitlements:
      - id: member
        display_name: Member
        description: m
        purpose: permission
        grantable_to: [user]
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: member
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('entitlement-id-reference: expression-style value is skipped', () => {
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
    static_entitlements:
      - id: member
        display_name: Member
        description: m
        purpose: permission
        grantable_to: [user]
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: ".role"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('entitlement-id-reference: documents with no static entitlements skip checks', () => {
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
          - principal_id: ".u"
            principal_type: user
            entitlement_id: admn
`;
  const results = run(yaml).filter(r => !r.isValid);
  // No static_entitlements anywhere → skip even literal-looking values.
  assert.equal(results.length, 0);
});

test('entitlement-id-reference: literal typo against literal set is rejected with did-you-mean', () => {
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
    static_entitlements:
      - id: admin
        display_name: Admin
        description: a
        purpose: permission
        grantable_to: [user]
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u"
            principal_type: user
            entitlement_id: admn
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /admn/);
  assert.match(results[0].errorMessage || '', /Did you mean.*admin/i);
});

test('entitlement-id-reference: multiple offending mappings produce multiple diagnostics', () => {
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
    static_entitlements:
      - id: admin
        display_name: Admin
        description: a
        purpose: permission
        grantable_to: [user]
      - id: member
        display_name: Member
        description: m
        purpose: permission
        grantable_to: [user]
    grants:
      - query: SELECT 1
        map:
          - principal_id: ".u1"
            principal_type: user
            entitlement_id: admn
          - principal_id: ".u2"
            principal_type: user
            entitlement_id: memba
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 2);
});
