import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traitColumnReferenceRule } from './traitColumnReferenceRule';
import { buildBatonDocument } from '../document';

function run(yaml: string) {
  const doc = buildBatonDocument(yaml);
  const out = traitColumnReferenceRule.validate('', yaml, { document: doc });
  return Array.isArray(out) ? out : [out];
}

const BASE = `
app_name: test
connect:
  dsn: postgres://x
`;

test('trait-column-reference: trait that references a selected column is valid', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, login, email FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".login"
            emails: [".email"]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('trait-column-reference: SELECT * skips verification entirely', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT * FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".nonexistent_column"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('trait-column-reference: parse-failed query skips verification', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECTT id FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".nonexistent_column"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});

test('trait-column-reference: trait references a non-selected column → diagnostic', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, login FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".email"
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 1);
  assert.match(results[0].errorMessage || '', /\.email/);
  assert.match(results[0].errorMessage || '', /not selected/i);
});

test('trait-column-reference: multiple bad refs across nested fields produce multiple diagnostics', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, login FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".login"
        traits:
          user:
            login: ".email"
            employee_ids: [".empid"]
            profile:
              department: ".dept"
`;
  const results = run(yaml).filter(r => !r.isValid);
  // .email, .empid, .dept all referenced but not selected → 3 diagnostics
  assert.equal(results.length, 3);
});

test('trait-column-reference: alias counts as available column', () => {
  const yaml = BASE + `
resource_types:
  user:
    name: User
    description: u
    list:
      query: "SELECT id, mail AS email FROM users"
      pagination: { strategy: offset, primary_key: id }
      map:
        id: ".id"
        display_name: ".id"
        traits:
          user:
            emails: [".email"]
`;
  const results = run(yaml).filter(r => !r.isValid);
  assert.equal(results.length, 0);
});
