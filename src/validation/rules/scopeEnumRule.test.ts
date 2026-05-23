import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeEnumRule } from './scopeEnumRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = scopeEnumRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

test('scope-enum: empty scope is valid', () => {
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
  const results = run(yaml);
  assert.equal(results.filter(r => !r.isValid).length, 0);
});

test('scope-enum: scope=cluster is valid', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      scope: cluster
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml);
  assert.equal(results.filter(r => !r.isValid).length, 0);
});

test('scope-enum: typo "clustr" produces a did-you-mean diagnostic', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      scope: clustr
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /clustr/);
  assert.match(results[0].errorMessage || '', /Did you mean.*cluster/i);
});

test('scope-enum: unrecognized value without close match produces a generic diagnostic', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      scope: global
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /global/);
  assert.match(results[0].errorMessage || '', /must be empty or .*cluster/i);
});

test('scope-enum: checks scope on entitlements + grants[] independently', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    entitlements:
      scope: clustr
      query: SELECT 1
      map:
        - id: x
          display_name: x
          description: x
          purpose: permission
          grantable_to: [user]
    grants:
      - scope: wrong
        query: SELECT 1
        map:
          - principal_id: x
            principal_type: user
            entitlement_id: x
`;
  const results = run(yaml).filter(r => !r.isValid);
  // Two diagnostics: one for entitlements.scope=clustr, one for grants[0].scope=wrong.
  assert.equal(results.length, 2);
});
