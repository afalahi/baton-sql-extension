import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { resolveVarsScope, buildBatonDocument } from './document';

function parse(content: string): any {
  return yaml.load(content);
}

test('resolveVarsScope: list query picks up list.vars', () => {
  const doc = parse(`
resource_types:
  user:
    list:
      vars:
        team_id: input.team_id
      query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['resource_types', 'user', 'list', 'query']);
  assert.equal(scope.get('team_id'), 'input.team_id');
});

test('resolveVarsScope: grants[i] query picks up grants[i].vars', () => {
  const doc = parse(`
resource_types:
  user:
    grants:
      - vars:
          resource_id: resource.ID
        query: SELECT 1
      - vars:
          other_id: principal.ID
        query: SELECT 2
`);
  const scope0 = resolveVarsScope(doc, ['resource_types', 'user', 'grants', 0, 'query']);
  const scope1 = resolveVarsScope(doc, ['resource_types', 'user', 'grants', 1, 'query']);
  assert.equal(scope0.get('resource_id'), 'resource.ID');
  assert.equal(scope0.has('other_id'), false);
  assert.equal(scope1.get('other_id'), 'principal.ID');
});

test('resolveVarsScope: static_entitlements provisioning.grant picks up provisioning.vars', () => {
  const doc = parse(`
resource_types:
  user:
    static_entitlements:
      - id: admin
        provisioning:
          vars:
            principal_id: principal.ID
          grant:
            queries:
              - SELECT 1
              - SELECT 2
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'static_entitlements', 0, 'provisioning', 'grant', 'queries', 1,
  ]);
  assert.equal(scope.get('principal_id'), 'principal.ID');
});

test('resolveVarsScope: account_provisioning create.queries picks up create.vars', () => {
  const doc = parse(`
resource_types:
  user:
    account_provisioning:
      create:
        vars:
          username: input.username
        queries:
          - SELECT 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'account_provisioning', 'create', 'queries', 0,
  ]);
  assert.equal(scope.get('username'), 'input.username');
});

test('resolveVarsScope: account_provisioning validate.query picks up validate.vars', () => {
  const doc = parse(`
resource_types:
  user:
    account_provisioning:
      validate:
        vars:
          email: input.email
        query: SELECT 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'account_provisioning', 'validate', 'query',
  ]);
  assert.equal(scope.get('email'), 'input.email');
});

test('resolveVarsScope: actions query picks up actions.vars and arguments keys', () => {
  const doc = parse(`
actions:
  disable_user:
    vars:
      timestamp: input.timestamp
    arguments:
      user_id:
        type: string
    query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['actions', 'disable_user', 'query']);
  assert.equal(scope.get('timestamp'), 'input.timestamp');
  assert.equal(scope.get('user_id'), 'string'); // argument key → its type as the "value"
});

test('resolveVarsScope: empty when no vars in scope', () => {
  const doc = parse(`
resource_types:
  user:
    list:
      query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['resource_types', 'user', 'list', 'query']);
  assert.equal(scope.size, 0);
});

test('resolveVarsScope: returns empty map for unknown path', () => {
  const doc = parse(`app_name: x`);
  const scope = resolveVarsScope(doc, ['nonexistent', 'path']);
  assert.equal(scope.size, 0);
});

test('resolveVarsScope: entitlements.query picks up entitlements.vars', () => {
  const doc = parse(`
resource_types:
  user:
    entitlements:
      vars:
        resource_id: resource.ID
      query: SELECT 1
`);
  const scope = resolveVarsScope(doc, ['resource_types', 'user', 'entitlements', 'query']);
  assert.equal(scope.get('resource_id'), 'resource.ID');
});

test('resolveVarsScope: entitlements.map[i].provisioning.grant picks up map[i].provisioning.vars', () => {
  const doc = parse(`
resource_types:
  user:
    entitlements:
      query: SELECT * FROM perms
      map:
        - id: ".name"
          provisioning:
            vars:
              principal_id: principal.ID
            grant:
              queries:
                - SELECT 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'entitlements', 'map', 0, 'provisioning', 'grant', 'queries', 0,
  ]);
  assert.equal(scope.get('principal_id'), 'principal.ID');
});

test('resolveVarsScope: entitlements.map[i].provisioning.revoke picks up map[i].provisioning.vars', () => {
  const doc = parse(`
resource_types:
  user:
    entitlements:
      query: SELECT * FROM perms
      map:
        - id: ".name"
          provisioning:
            vars:
              principal_id: principal.ID
            revoke:
              queries:
                - DELETE 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'entitlements', 'map', 0, 'provisioning', 'revoke', 'queries', 0,
  ]);
  assert.equal(scope.get('principal_id'), 'principal.ID');
});

test('resolveVarsScope: static_entitlements.revoke uses the same provisioning.vars as grant', () => {
  const doc = parse(`
resource_types:
  user:
    static_entitlements:
      - id: admin
        provisioning:
          vars:
            principal_id: principal.ID
          revoke:
            queries:
              - DELETE 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'static_entitlements', 0, 'provisioning', 'revoke', 'queries', 0,
  ]);
  assert.equal(scope.get('principal_id'), 'principal.ID');
});

test('resolveVarsScope: credential_rotation.update.queries picks up update.vars', () => {
  const doc = parse(`
resource_types:
  user:
    credential_rotation:
      update:
        vars:
          new_password: input.password
        queries:
          - UPDATE 1
`);
  const scope = resolveVarsScope(doc, [
    'resource_types', 'user', 'credential_rotation', 'update', 'queries', 0,
  ]);
  assert.equal(scope.get('new_password'), 'input.password');
});

test('resolveVarsScope: actions.queries[j] picks up actions.vars + arguments', () => {
  const doc = parse(`
actions:
  batch:
    vars:
      ts: input.timestamp
    arguments:
      id:
        type: string
    queries:
      - SELECT 1
      - SELECT 2
`);
  const scope = resolveVarsScope(doc, ['actions', 'batch', 'queries', 1]);
  assert.equal(scope.get('ts'), 'input.timestamp');
  assert.equal(scope.get('id'), 'string');
});

test('buildBatonDocument: returns degraded doc on invalid YAML', () => {
  const doc = buildBatonDocument(': not: valid: yaml: at: all');
  assert.equal(doc.yaml, null);
  assert.equal(doc.queries.length, 0);
  assert.equal(doc.resourceTypes.size, 0);
  assert.equal(doc.actions.size, 0);
  assert.equal(doc.definedEntitlementIds.literal.size, 0);
  assert.equal(doc.definedEntitlementIds.expression.size, 0);
  assert.equal(doc.knownResourceTypeIds.size, 0);
  assert.equal(doc.connect, undefined);
});

test('buildBatonDocument: empty YAML produces empty doc', () => {
  const doc = buildBatonDocument('');
  assert.equal(doc.queries.length, 0);
  assert.equal(doc.resourceTypes.size, 0);
  assert.equal(doc.connect, undefined);
});

test('buildBatonDocument: connect populated when present', () => {
  const doc = buildBatonDocument(`
app_name: test
connect:
  scheme: postgres
  host: localhost
  database: app
  user: u
  password: p
`);
  assert.equal(doc.connect?.scheme, 'postgres');
  assert.equal(doc.connect?.host, 'localhost');
  assert.equal(doc.connect?.database, 'app');
});
