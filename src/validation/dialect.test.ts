import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemeToDialect } from './dialect';

test('schemeToDialect: postgres variants → postgresql', () => {
  assert.equal(schemeToDialect('postgres'), 'postgresql');
  assert.equal(schemeToDialect('postgresql'), 'postgresql');
  assert.equal(schemeToDialect('pg'), 'postgresql');
  assert.equal(schemeToDialect('PostgreSQL'), 'postgresql');
  assert.equal(schemeToDialect('POSTGRES'), 'postgresql');
});

test('schemeToDialect: mysql variants → mysql', () => {
  assert.equal(schemeToDialect('mysql'), 'mysql');
  assert.equal(schemeToDialect('mysql2'), 'mysql');
  assert.equal(schemeToDialect('MySQL'), 'mysql');
  assert.equal(schemeToDialect('mariadb'), 'mysql');
});

test('schemeToDialect: sqlserver variants → transactsql', () => {
  assert.equal(schemeToDialect('sqlserver'), 'transactsql');
  assert.equal(schemeToDialect('mssql'), 'transactsql');
  assert.equal(schemeToDialect('tsql'), 'transactsql');
});

test('schemeToDialect: sqlite → sqlite', () => {
  assert.equal(schemeToDialect('sqlite'), 'sqlite');
});

test('schemeToDialect: snowflake → snowflake', () => {
  assert.equal(schemeToDialect('snowflake'), 'snowflake');
});

test('schemeToDialect: bigquery → bigquery', () => {
  assert.equal(schemeToDialect('bigquery'), 'bigquery');
});

test('schemeToDialect: oracle → undefined (no node-sql-parser support)', () => {
  // node-sql-parser 5.3.9 does not support Oracle. Fall back to default
  // so the parser at least attempts the query (mysql-flavored).
  assert.equal(schemeToDialect('oracle'), undefined);
});

test('schemeToDialect: hdb (SAP HANA) → undefined', () => {
  assert.equal(schemeToDialect('hdb'), undefined);
});

test('schemeToDialect: unknown scheme → undefined', () => {
  assert.equal(schemeToDialect('cockroach'), undefined);
  assert.equal(schemeToDialect('weird-thing'), undefined);
});

test('schemeToDialect: empty/undefined input → undefined', () => {
  assert.equal(schemeToDialect(''), undefined);
  assert.equal(schemeToDialect(undefined), undefined);
});
