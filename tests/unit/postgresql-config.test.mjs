import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPostgresqlPool,
  loadPostgresqlConfig
} from '../../apps/api/src/db/postgresql/postgresql-config.mjs';

const LOCAL_URL = 'postgresql://dojo:password@127.0.0.1:5432/dojo_test';
const REMOTE_URL = 'postgresql://dojo:password@db.example.com:5432/dojo';

test('PostgreSQL configは接続URLを必須化する', () => {
  assert.throws(
    () => loadPostgresqlConfig({}),
    /POSTGRESQL_DATABASE_URL is required/
  );
});

test('PostgreSQL configはprotocolと必須URL要素を検証する', () => {
  assert.throws(
    () => loadPostgresqlConfig({ POSTGRESQL_DATABASE_URL: 'https://db.example.com/dojo' }),
    /postgres or postgresql protocol/
  );
  assert.throws(
    () => loadPostgresqlConfig({ POSTGRESQL_DATABASE_URL: 'postgresql://db.example.com/dojo' }),
    /username, password, host, and database name/
  );
});

test('PostgreSQL configは既定でverify-fullとpublic schemaを使用する', () => {
  const config = loadPostgresqlConfig({
    POSTGRESQL_DATABASE_URL: REMOTE_URL
  });

  assert.equal(config.schema, 'public');
  assert.equal(config.sslMode, 'verify-full');
  assert.deepEqual(config.poolOptions.ssl, { rejectUnauthorized: true });
  assert.equal(config.poolOptions.max, 4);
  assert.equal(config.poolOptions.options, '-c search_path=public');
});

test('SSL無効化はlocalhostまたはtest環境だけ許可する', () => {
  assert.throws(
    () => loadPostgresqlConfig({
      POSTGRESQL_DATABASE_URL: REMOTE_URL,
      POSTGRESQL_SSL_MODE: 'disable'
    }),
    /only allowed for localhost or NODE_ENV=test/
  );

  const local = loadPostgresqlConfig({
    POSTGRESQL_DATABASE_URL: LOCAL_URL,
    POSTGRESQL_SSL_MODE: 'disable'
  });
  assert.equal(local.poolOptions.ssl, false);

  const testEnvironment = loadPostgresqlConfig({
    NODE_ENV: 'test',
    POSTGRESQL_DATABASE_URL: REMOTE_URL,
    POSTGRESQL_SSL_MODE: 'disable'
  });
  assert.equal(testEnvironment.poolOptions.ssl, false);
});

test('schemaとpool設定をfail-closedで検証する', () => {
  assert.throws(
    () => loadPostgresqlConfig({
      POSTGRESQL_DATABASE_URL: LOCAL_URL,
      POSTGRESQL_SCHEMA: 'Invalid-Schema'
    }),
    /lowercase SQL identifier/
  );
  assert.throws(
    () => loadPostgresqlConfig({
      POSTGRESQL_DATABASE_URL: LOCAL_URL,
      POSTGRESQL_POOL_MAX: '0'
    }),
    /POSTGRESQL_POOL_MAX/
  );
  assert.throws(
    () => loadPostgresqlConfig({
      POSTGRESQL_DATABASE_URL: LOCAL_URL,
      POSTGRESQL_CONNECTION_TIMEOUT_MS: 'not-a-number'
    }),
    /POSTGRESQL_CONNECTION_TIMEOUT_MS/
  );
});

test('pool生成へ検証済みoptionだけを渡す', async () => {
  let captured;
  class FakePool {
    constructor(options) {
      captured = options;
    }
  }

  const config = loadPostgresqlConfig({
    POSTGRESQL_DATABASE_URL: LOCAL_URL,
    POSTGRESQL_SSL_MODE: 'disable',
    POSTGRESQL_SCHEMA: 'contract_test',
    POSTGRESQL_POOL_MAX: '2'
  });
  const pool = await createPostgresqlPool({ config, PoolClass: FakePool });

  assert.ok(pool instanceof FakePool);
  assert.equal(captured.connectionString, LOCAL_URL);
  assert.equal(captured.max, 2);
  assert.equal(captured.options, '-c search_path=contract_test');
  assert.equal(captured.ssl, false);
});
