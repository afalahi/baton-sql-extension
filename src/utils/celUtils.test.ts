import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractColumnRefs } from './celUtils';

test('extractColumnRefs: empty string returns []', () => {
  assert.deepEqual(extractColumnRefs(''), []);
});

test('extractColumnRefs: simple leading-dot reference', () => {
  assert.deepEqual(extractColumnRefs('.login'), ['login']);
});

test('extractColumnRefs: concatenation of multiple refs', () => {
  assert.deepEqual(extractColumnRefs('.first_name + " " + .last_name'), ['first_name', 'last_name']);
});

test('extractColumnRefs: function wrapper', () => {
  assert.deepEqual(extractColumnRefs('slugify(.login)'), ['login']);
  assert.deepEqual(extractColumnRefs('lower(.email)'), ['email']);
});

test('extractColumnRefs: chained access extracts only top-level column', () => {
  assert.deepEqual(extractColumnRefs('.profile.first_name'), ['profile']);
});

test('extractColumnRefs: complex expressions', () => {
  // CEL conditional with multiple top-level refs
  const refs = extractColumnRefs('if .active then .login else "disabled"');
  assert.deepEqual(refs.sort(), ['active', 'login']);
});
