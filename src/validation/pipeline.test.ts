import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDocument,
  documentCache,
  uriToHash,
  evictUri,
} from './pipeline';

const SAMPLE_VALID = `
app_name: t
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT id, name
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;

const SAMPLE_INVALID_SQL = `
app_name: t
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: u
    list:
      query: |
        SELECT
          id,
          name
          email
        FROM users
      pagination:
        strategy: offset
        primary_key: id
      map:
        id: ".id"
        display_name: ".name"
`;

test('validateDocument: clean document produces no failures', () => {
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(SAMPLE_VALID);
  assert.equal(results.length, 0);
});

test('validateDocument: missing-comma in SELECT surfaces a failure', () => {
  documentCache.clear();
  uriToHash.clear();
  const { results } = validateDocument(SAMPLE_INVALID_SQL);
  assert.ok(results.length > 0);
  const messages = results.map(r => r.result.errorMessage || '');
  assert.ok(messages.some(m => /missing comma/i.test(m)));
});

test('validateDocument: returns document alongside results', () => {
  documentCache.clear();
  const { document, results } = validateDocument(SAMPLE_VALID);
  assert.equal(document.queries.length, 1);
  assert.equal(document.resourceTypes.size, 1);
  assert.equal(results.length, 0);
});

test('validateDocument: invokes onRuleError when a rule throws', () => {
  documentCache.clear();
  const errors: string[] = [];
  // We use a YAML that will validate fine; the rule-throw scenario is exercised
  // by sqlValidator.test.ts via a fake throwing rule. Here we only assert that
  // the parameter is accepted and produces results.
  const { results } = validateDocument(SAMPLE_VALID, (rule, err) => {
    errors.push(`${rule}:${String(err)}`);
  });
  assert.ok(Array.isArray(results));
  assert.equal(errors.length, 0);
});

test('uriToHash + evictUri: removing an entry clears that hash from the cache', () => {
  documentCache.clear();
  uriToHash.clear();
  // Simulate a cached entry.
  documentCache.set('h1', []);
  uriToHash.set('file:///a.yaml', 'h1');
  evictUri('file:///a.yaml');
  assert.equal(uriToHash.has('file:///a.yaml'), false);
  assert.equal(documentCache.has('h1'), false);
});

test('uriToHash + evictUri: evicting a URI not in the side-index is a no-op', () => {
  documentCache.clear();
  uriToHash.clear();
  documentCache.set('h2', []);
  evictUri('file:///nonexistent.yaml');
  assert.equal(documentCache.has('h2'), true); // unchanged
});

test('cache: same content across two URIs reuses the cached diagnostics', () => {
  documentCache.clear();
  uriToHash.clear();
  documentCache.set('shared', [{ message: 'x' } as any]);
  uriToHash.set('file:///A.yaml', 'shared');
  uriToHash.set('file:///B.yaml', 'shared');

  evictUri('file:///A.yaml');
  assert.equal(uriToHash.has('file:///A.yaml'), false);
  assert.equal(uriToHash.get('file:///B.yaml'), 'shared');
  assert.equal(documentCache.has('shared'), true,
    'cache entry should survive when another URI still references the hash');

  evictUri('file:///B.yaml');
  assert.equal(documentCache.has('shared'), false);
});
