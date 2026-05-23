import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeLiteralReference } from './stringUtils';

test('looksLikeLiteralReference: plain identifiers are literal', () => {
  assert.equal(looksLikeLiteralReference('user'), true);
  assert.equal(looksLikeLiteralReference('group'), true);
  assert.equal(looksLikeLiteralReference('role_admin'), true);
  assert.equal(looksLikeLiteralReference('role:admin'), true);
  assert.equal(looksLikeLiteralReference('foo-bar'), true);
  assert.equal(looksLikeLiteralReference('_underscore'), true);
});

test('looksLikeLiteralReference: expressions and edge cases are not literal', () => {
  assert.equal(looksLikeLiteralReference('.column'), false);    // jq-style
  assert.equal(looksLikeLiteralReference('row.field'), false);  // dotted
  assert.equal(looksLikeLiteralReference('"user"'), false);     // quoted
  assert.equal(looksLikeLiteralReference("'user'"), false);     // quoted
  assert.equal(looksLikeLiteralReference('a || b'), false);     // operator + space
  assert.equal(looksLikeLiteralReference(''), false);           // empty
  assert.equal(looksLikeLiteralReference('1starts_with_digit'), false);
  assert.equal(looksLikeLiteralReference('foo:'), false);       // trailing colon
  assert.equal(looksLikeLiteralReference(':foo'), false);       // leading colon
});
