import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propertyNameTyposRule } from './propertyNameTyposRule';

const v = (yaml: string) => propertyNameTyposRule.validate(yaml, yaml);

test('property-name-typos: correct property name is valid', () => {
  assert.equal(v('static_entitlements:').isValid, true);
});

test('property-name-typos: singular form is flagged', () => {
  const r = v('static_entitlement:');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /static_entitlements/);
});

test('property-name-typos: concatenated form is flagged', () => {
  const r = v('staticentitlements:');
  assert.equal(r.isValid, false);
  assert.match(r.errorMessage || '', /static_entitlements/);
});
