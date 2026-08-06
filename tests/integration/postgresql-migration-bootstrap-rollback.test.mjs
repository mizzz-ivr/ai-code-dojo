import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runPostgresqlMigrations } from '../../apps/api/src/db/migrations/postgresql-migration-runner.mjs';
import {
  createPostgresqlPool,
  loadPostgresqlConfig
} from '../../apps/api/src/db/postgresql/postgresql-config.mjs';

const connectionString = process.env.POSTGRESQL_TEST_DATABASE_URL;
const skipReason = connectionString
  ? false
  : 'POSTGRESQL_TEST_DATABASE_URL is not configured.';

const failingInitialManifest = [
  {
    version: 1,
    name: 'initial_failure_probe',
    providers: {
      sqlite: {
        steps: [
          {
            type: 'sql',
            sql: 'CREATE TABLE initial_failure_probe (id INTEGER PRIMARY KEY);'
          }
        ]
      },
      postgresql: {
        steps: [
          {
            type: 'sql',
            sql: 'CREATE TABLE initial_failure_probe (id INTEGER PRIMARY KEY);'
          },
          {
            type: 'sql',
            sql: 'SELECT * FROM missing_initial_migration_source;'
          }
        ]
      }
    }
  }
];

test('初回migration失敗時にbootstrap履歴tableもrollbackする', { skip: skipReason }, async () => {
  const adminPool = new Pool({
    connectionString,
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 5000
  });
  const schema = `dojo_bootstrap_${randomUUID().replaceAll('-', '')}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);

  const config = loadPostgresqlConfig({
    NODE_ENV: 'test',
    POSTGRESQL_DATABASE_URL: connectionString,
    POSTGRESQL_SSL_MODE: 'disable',
    POSTGRESQL_SCHEMA: schema
  });
  const pool = await createPostgresqlPool({ config });

  try {
    await assert.rejects(
      runPostgresqlMigrations({
        pool,
        schema,
        migrations: failingInitialManifest
      }),
      /Migration 1 'initial_failure_probe' failed/
    );

    const relations = await pool.query(`
      SELECT
        to_regclass('schema_migrations') AS migration_history,
        to_regclass('initial_failure_probe') AS failure_probe
    `);
    assert.equal(relations.rows[0].migration_history, null);
    assert.equal(relations.rows[0].failure_probe, null);
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminPool.end();
  }
});
