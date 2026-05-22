import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from './parsedQuery';

test('parseQuery: valid SQL parses to an AST', () => {
  const q = parseQuery({
    rawSql: 'SELECT id FROM users',
    yamlPath: ['resource_types', 'user', 'list', 'query'],
    startOffset: 100,
    endOffset: 120,
    varsScope: new Map(),
  });
  assert.equal(q.rawSql, 'SELECT id FROM users');
  assert.equal(q.normalizedSql, 'SELECT id FROM users');
  assert.notEqual(q.ast, null);
  assert.equal(q.astError, null);
});

test('parseQuery: normalizes ?<param> to ?', () => {
  const q = parseQuery({
    rawSql: 'SELECT * FROM users WHERE id = ?<user_id>',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.equal(q.normalizedSql, 'SELECT * FROM users WHERE id = ?');
  assert.equal(q.rawSql, 'SELECT * FROM users WHERE id = ?<user_id>'); // unchanged
});

test('parseQuery: invalid SQL keeps ast=null and astError set', () => {
  const q = parseQuery({
    rawSql: 'SELECT FROM WHERE',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.equal(q.ast, null);
  assert.ok(q.astError && q.astError.length > 0);
});

test('parseQuery: usedParams extracted from raw SQL', () => {
  const q = parseQuery({
    rawSql: 'SELECT * FROM t WHERE a = ?<user_id> AND b = ?<tenant_id> AND c = ?<user_id>',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.deepEqual([...q.usedParams].sort(), ['tenant_id', 'user_id']);
});

test('parseQuery: usedParams empty when no Baton params', () => {
  const q = parseQuery({
    rawSql: 'SELECT * FROM users',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.equal(q.usedParams.size, 0);
});

test('parseQuery: varsScope preserved as-is', () => {
  const scope = new Map([['user_id', 'resource.ID'], ['tenant', 'input.tenant']]);
  const q = parseQuery({
    rawSql: 'SELECT 1',
    yamlPath: [],
    startOffset: 0,
    endOffset: 0,
    varsScope: scope,
  });
  assert.equal(q.varsScope.get('user_id'), 'resource.ID');
  assert.equal(q.varsScope.get('tenant'), 'input.tenant');
});

test('parseQuery: yamlPath mixed string/number elements preserved', () => {
  const q = parseQuery({
    rawSql: 'SELECT 1',
    yamlPath: ['resource_types', 'user', 'grants', 2, 'query'],
    startOffset: 0,
    endOffset: 0,
    varsScope: new Map(),
  });
  assert.deepEqual(q.yamlPath, ['resource_types', 'user', 'grants', 2, 'query']);
});
