import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databasesConfigRule } from './databasesConfigRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = databasesConfigRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

test('databases-config: no databases block is valid', () => {
  const yaml = `
connect:
  dsn: postgres://x
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('databases-config: only static is valid', () => {
  const yaml = `
connect:
  dsn: postgres://x
  databases:
    static:
      - app
      - reports
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('databases-config: only discovery_query is valid', () => {
  const yaml = `
connect:
  dsn: postgres://x
  databases:
    discovery_query: "SELECT datname FROM pg_database"
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('databases-config: both static AND discovery_query is rejected', () => {
  const yaml = `
connect:
  dsn: postgres://x
  databases:
    static: [a, b]
    discovery_query: "SELECT datname FROM pg_database"
resource_types: {}
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /static.*discovery_query|exactly one/i);
});
