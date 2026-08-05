import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  createDatabaseClient,
  loadDatabaseProvider
} from '../../apps/api/src/db/adapters/database-client-factory.mjs';
import { toPostgresqlPlaceholders } from '../../apps/api/src/db/adapters/postgresql-placeholders.mjs';
import { createFakePostgresqlPool } from './helpers/fake-postgresql-pool.mjs';

test('DB_PROVIDER未指定時はSQLiteを選択する', () => {
  assert.equal(loadDatabaseProvider({}), 'sqlite');
});

test('DB_PROVIDERは大文字小文字と前後空白を正規化する', () => {
  assert.equal(loadDatabaseProvider({ DB_PROVIDER: ' PostgreSQL ' }), 'postgresql');
});

test('未対応DB_PROVIDERをfail-closedで拒否する', () => {
  assert.throws(
    () => loadDatabaseProvider({ DB_PROVIDER: 'mysql' }),
    /DB_PROVIDER must be sqlite or postgresql/
  );
});

test('factoryがSQLite clientを生成する', async () => {
  const client = createDatabaseClient({
    environment: { DB_PROVIDER: 'sqlite' },
    sqliteDatabase: new DatabaseSync(':memory:')
  });
  await client.execute('CREATE TABLE sample (id INTEGER PRIMARY KEY)');
  await client.close();
});

test('factoryがPostgreSQL client境界を生成する', async () => {
  const client = createDatabaseClient({
    environment: { DB_PROVIDER: 'postgresql' },
    postgresqlPool: createFakePostgresqlPool()
  });
  const rows = await client.query('SELECT 1');
  assert.deepEqual(rows, [{ '?column?': 1 }]);
  await client.close();
});

test('PostgreSQL placeholderは文字列literal外だけ変換する', () => {
  assert.equal(
    toPostgresqlPlaceholders("SELECT '?' AS literal, id FROM sample WHERE id = ? AND name = ?"),
    "SELECT '?' AS literal, id FROM sample WHERE id = $1 AND name = $2"
  );
});

test('単一引用符が閉じていないSQLを拒否する', () => {
  assert.throws(
    () => toPostgresqlPlaceholders("SELECT 'broken WHERE id = ?"),
    /unterminated single-quoted string/
  );
});
