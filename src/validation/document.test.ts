import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { resolveVarsScope, buildBatonDocument } from './document';
import { schemeToDialect } from './dialect';

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
  assert.equal(doc.yaml, null); // js-yaml returns undefined for empty string → degraded path
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

test('buildBatonDocument: walks list query', () => {
  const yaml = `
app_name: test
connect:
  dsn: postgres://x
resource_types:
  user:
    name: User
    description: A user
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
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user');
  assert.ok(rt, 'should have user resource type');
  assert.equal(rt!.name, 'User');
  assert.equal(rt!.description, 'A user');
  assert.ok(rt!.list?.query, 'should have list query');
  assert.ok(rt!.list!.query!.rawSql.includes('SELECT id, name'));
  assert.equal(doc.queries.length, 1);
  assert.equal(doc.queries[0].yamlPath[0], 'resource_types');
  assert.equal(doc.queries[0].yamlPath[1], 'user');
});

test('buildBatonDocument: walks entitlements query and map', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: A user
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    entitlements:
      query: |
        SELECT entitlement_name FROM perms
      map:
        - id: ".entitlement_name"
          display_name: ".entitlement_name"
          description: "perm"
          purpose: permission
          grantable_to: [user]
`;
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user')!;
  assert.ok(rt.entitlements?.query);
  assert.equal(doc.queries.length, 2);
});

test('buildBatonDocument: walks multiple grants entries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: A user
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 1 FROM perms
        vars:
          resource_id: resource.ID
        map:
          - principal_id: ".user_id"
            principal_type: user
            entitlement_id: admin
      - query: SELECT 2 FROM other
        map:
          - principal_id: ".user_id"
            principal_type: user
            entitlement_id: member
`;
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user')!;
  assert.equal(rt.grants.length, 2);
  assert.ok(rt.grants[0].query?.rawSql.includes('FROM perms'));
  assert.ok(rt.grants[1].query?.rawSql.includes('FROM other'));
  assert.equal(doc.queries.length, 3);
  assert.equal(rt.grants[0].vars.get('resource_id'), 'resource.ID');
});

test('buildBatonDocument: walks static_entitlements with provisioning queries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: A user
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - id: admin
        display_name: Admin
        description: Admin
        purpose: permission
        grantable_to: [user]
        provisioning:
          vars:
            principal_id: principal.ID
          grant:
            queries:
              - "INSERT INTO admin (user_id) VALUES (?<principal_id>)"
          revoke:
            queries:
              - "DELETE FROM admin WHERE user_id = ?<principal_id>"
`;
  const doc = buildBatonDocument(yaml);
  const rt = doc.resourceTypes.get('user')!;
  assert.equal(rt.staticEntitlements.length, 1);
  assert.equal(rt.staticEntitlements[0].id, 'admin');
  assert.equal(doc.queries.length, 3);
  // Verify varsScope on a provisioning query. The full path for the grant
  // query is ['resource_types','user','static_entitlements',0,'provisioning','grant','queries',0]
  const grantQ = doc.queries.find(q =>
    q.yamlPath[2] === 'static_entitlements' && q.yamlPath[4] === 'provisioning'
    && q.yamlPath[5] === 'grant'
  );
  assert.ok(grantQ, 'should find the grant provisioning query');
  assert.equal(grantQ!.varsScope.get('principal_id'), 'principal.ID');
  assert.ok(grantQ!.usedParams.has('principal_id'));
});

test('buildBatonDocument: yamlPath uses numeric indices for arrays', () => {
  const yaml = `
resource_types:
  user:
    name: U
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT GRANT FROM g
        map:
          - principal_id: ".id"
            principal_type: user
            entitlement_id: m
`;
  const doc = buildBatonDocument(yaml);
  const grantQ = doc.queries.find(q => q.rawSql.includes('GRANT'));
  assert.ok(grantQ);
  assert.deepEqual(grantQ!.yamlPath, ['resource_types', 'user', 'grants', 0, 'query']);
});

test('buildBatonDocument: walks account_provisioning.create.queries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: username, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password: { preferred: true }
      validate:
        vars:
          email: input.email
        query: "SELECT 1 FROM users WHERE email = ?<email>"
      create:
        vars:
          username: input.username
        queries:
          - "INSERT INTO users (name) VALUES (?<username>)"
          - "SELECT last_insert_id()"
`;
  const doc = buildBatonDocument(yaml);
  // list + validate.query + 2 create.queries = 4
  assert.equal(doc.queries.length, 4);
  const validateQ = doc.queries.find(q => q.yamlPath.includes('validate'));
  assert.ok(validateQ);
  assert.equal(validateQ!.varsScope.get('email'), 'input.email');
  assert.ok(validateQ!.usedParams.has('email'));
  const createQ0 = doc.queries.find(q =>
    q.yamlPath.includes('create') && q.yamlPath[q.yamlPath.length - 1] === 0
  );
  assert.ok(createQ0);
  assert.equal(createQ0!.varsScope.get('username'), 'input.username');
});

test('buildBatonDocument: walks credential_rotation.update.queries', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    credential_rotation:
      credentials:
        random_password: { preferred: true }
      update:
        vars:
          new_password: input.password
        queries:
          - "UPDATE users SET pw = ?<new_password>"
`;
  const doc = buildBatonDocument(yaml);
  // list + 1 update query = 2
  assert.equal(doc.queries.length, 2);
  const updateQ = doc.queries.find(q => q.yamlPath.includes('credential_rotation'));
  assert.ok(updateQ);
  assert.equal(updateQ!.varsScope.get('new_password'), 'input.password');
});

test('buildBatonDocument: walks entitlements.map[].provisioning queries', () => {
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
      query: SELECT 1 FROM perms
      map:
        - id: ".name"
          display_name: ".name"
          description: ent
          purpose: permission
          grantable_to: [user]
          provisioning:
            vars:
              principal_id: principal.ID
            grant:
              queries:
                - "INSERT INTO ents (user) VALUES (?<principal_id>)"
            revoke:
              queries:
                - "DELETE FROM ents WHERE user = ?<principal_id>"
`;
  const doc = buildBatonDocument(yaml);
  // list + entitlements.query + 1 grant + 1 revoke = 4
  assert.equal(doc.queries.length, 4);
  const grantQ = doc.queries.find(q =>
    q.yamlPath.includes('provisioning') && q.yamlPath.includes('grant')
  );
  assert.ok(grantQ);
  assert.equal(grantQ!.varsScope.get('principal_id'), 'principal.ID');
});

test('buildBatonDocument: walks actions with single query', () => {
  const yaml = `
actions:
  disable_user:
    name: Disable
    arguments:
      user_id: { name: User, type: string, required: true, description: x }
    query: "UPDATE users SET active=false WHERE id=?<user_id>"
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries.length, 1);
  const action = doc.actions.get('disable_user');
  assert.ok(action);
  assert.equal(action!.name, 'Disable');
  assert.ok(action!.query);
  assert.equal(action!.query!.varsScope.get('user_id'), 'string');
  assert.equal(action!.query!.yamlPath[0], 'actions');
});

test('buildBatonDocument: walks actions with queries array', () => {
  const yaml = `
actions:
  batch_update:
    name: Batch
    vars:
      ts: input.timestamp
    queries:
      - UPDATE a SET x=1
      - UPDATE b SET y=2
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries.length, 2);
  const action = doc.actions.get('batch_update');
  assert.ok(action);
  assert.equal(action!.queries?.length, 2);
  assert.equal(action!.queries![0].varsScope.get('ts'), 'input.timestamp');
});

test('buildBatonDocument: definedEntitlementIds.literal from static_entitlements', () => {
  const yaml = `
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - { id: admin, display_name: A, description: a, purpose: permission, grantable_to: [user] }
      - { id: member, display_name: M, description: m, purpose: assignment, grantable_to: [user] }
  team:
    name: Team
    description: t
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    static_entitlements:
      - { id: owner, display_name: O, description: o, purpose: permission, grantable_to: [user] }
`;
  const doc = buildBatonDocument(yaml);
  assert.deepEqual(
    [...doc.definedEntitlementIds.literal].sort(),
    ['admin', 'member', 'owner']
  );
});

test('buildBatonDocument: definedEntitlementIds.expression from entitlements.map', () => {
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
      query: SELECT * FROM perms
      map:
        - id: ".name"
          display_name: ".name"
          description: x
          purpose: permission
          grantable_to: [user]
        - id: "slugify(.name)"
          display_name: ".name"
          description: y
          purpose: permission
          grantable_to: [user]
`;
  const doc = buildBatonDocument(yaml);
  assert.deepEqual(
    [...doc.definedEntitlementIds.expression].sort(),
    ['.name', 'slugify(.name)']
  );
  assert.equal(doc.definedEntitlementIds.literal.size, 0);
});

test('buildBatonDocument: knownResourceTypeIds is the resource_types key set', () => {
  const yaml = `
resource_types:
  user:
    name: U
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  group:
    name: G
    description: g
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
  role:
    name: R
    description: r
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const doc = buildBatonDocument(yaml);
  assert.deepEqual([...doc.knownResourceTypeIds].sort(), ['group', 'role', 'user']);
});

test('buildBatonDocument: passes connect.scheme dialect to every ParsedQuery', () => {
  const yaml = `
app_name: t
connect:
  scheme: postgres
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    grants:
      - query: SELECT 2 FROM g
        map:
          - principal_id: ".id"
            principal_type: user
            entitlement_id: m
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries.length, 2);
  for (const q of doc.queries) {
    assert.equal(q.dialect, 'postgresql', `yamlPath=${JSON.stringify(q.yamlPath)} should be postgresql`);
  }
});

test('buildBatonDocument: connect.scheme=mysql → dialect=mysql', () => {
  const yaml = `
connect:
  scheme: mysql
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries[0].dialect, 'mysql');
});

test('buildBatonDocument: connect.scheme=oracle → dialect=undefined (no parser support)', () => {
  const yaml = `
connect:
  scheme: oracle
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
`;
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries[0].dialect, undefined);
});

test('buildBatonDocument: no connect.scheme → dialect=undefined', () => {
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
  const doc = buildBatonDocument(yaml);
  assert.equal(doc.queries[0].dialect, undefined);
});

test('buildBatonDocument: ON CONFLICT in account_provisioning.create.queries parses with postgres scheme', () => {
  const yaml = `
connect:
  scheme: postgres
resource_types:
  user:
    name: User
    description: u
    list:
      query: SELECT 1
      pagination: { strategy: offset, primary_key: id }
      map: { id: ".id", display_name: ".name" }
    account_provisioning:
      schema:
        - { name: username, description: u, type: string, placeholder: x, required: true }
      credentials:
        random_password: { preferred: true }
      validate:
        query: "SELECT 1"
      create:
        queries:
          - "INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING"
`;
  const doc = buildBatonDocument(yaml);
  const conflictQ = doc.queries.find(q => q.rawSql.includes('ON CONFLICT'));
  assert.ok(conflictQ);
  assert.equal(conflictQ!.dialect, 'postgresql');
  assert.notEqual(conflictQ!.ast, null, 'ON CONFLICT should parse with postgres dialect');
  assert.equal(conflictQ!.astError, null);
});
