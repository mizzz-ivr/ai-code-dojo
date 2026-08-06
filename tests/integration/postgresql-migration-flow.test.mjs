import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrationManifest } from '../../apps/api/src/db/migrations/migration-manifest.mjs';
import {
  planPostgresqlMigrations,
  POSTGRESQL_MIGRATION_LOCK_IDS,
  runPostgresqlMigrations
} from '../../apps/api/src/db/migrations/postgresql-migration-runner.mjs';
import {
  createPostgresqlPool,
  loadPostgresqlConfig
} from '../../apps/api/src/db/postgresql/postgresql-config.mjs';

const connectionString = process.env.POSTGRESQL_TEST_DATABASE_URL;
const skipReason = connectionString
  ? false
  : 'POSTGRESQL_TEST_DATABASE_URL is not configured.';

const createSchemaName = () => `dojo_test_${randomUUID().replaceAll('-', '')}`;

const withTestSchema = async (operation) => {
  const adminPool = new Pool({
    connectionString,
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 5000
  });
  const schema = createSchemaName();
  await adminPool.query(`CREATE SCHEMA ${schema}`);

  const config = loadPostgresqlConfig({
    NODE_ENV: 'test',
    POSTGRESQL_DATABASE_URL: connectionString,
    POSTGRESQL_SSL_MODE: 'disable',
    POSTGRESQL_SCHEMA: schema,
    POSTGRESQL_POOL_MAX: '3'
  });
  const pool = await createPostgresqlPool({ config });

  try {
    await operation({ adminPool, pool, schema });
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminPool.end();
  }
};

const createFailureManifest = () => [
  ...migrationManifest,
  {
    version: 4,
    name: 'failure_probe',
    providers: {
      sqlite: {
        steps: [
          {
            type: 'sql',
            sql: 'CREATE TABLE migration_failure_probe (id INTEGER PRIMARY KEY);'
          }
        ]
      },
      postgresql: {
        steps: [
          {
            type: 'sql',
            sql: 'CREATE TABLE migration_failure_probe (id INTEGER PRIMARY KEY);'
          },
          {
            type: 'sql',
            sql: 'SELECT * FROM missing_migration_source;'
          }
        ]
      }
    }
  }
];

test('PostgreSQL 18.4でmigrationを適用し再実行をno-opにする', { skip: skipReason }, async () => {
  await withTestSchema(async ({ pool, schema }) => {
    const versionResult = await pool.query("SELECT current_setting('server_version') AS version");
    assert.match(versionResult.rows[0].version, /^18\.4(?:\D|$)/);

    const first = await runPostgresqlMigrations({ pool, schema });
    assert.deepEqual(first.appliedNow.map(({ version }) => version), [1, 2, 3]);
    assert.equal(first.pending.length, 0);

    const plan = await planPostgresqlMigrations({ pool, schema });
    assert.deepEqual(plan.applied.map(({ version, name }) => ({ version, name })), [
      { version: 1, name: 'core_schema' },
      { version: 2, name: 'submission_attempt_and_lease' },
      { version: 3, name: 'queue_outbox' }
    ]);
    assert.equal(plan.pending.length, 0);

    const second = await runPostgresqlMigrations({ pool, schema });
    assert.equal(second.appliedNow.length, 0);

    const tableResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
    `, [schema]);
    assert.deepEqual(tableResult.rows.map(({ table_name: tableName }) => tableName), [
      'challenge_versions',
      'challenges',
      'queue_outbox',
      'schema_migrations',
      'submissions'
    ]);

    await pool.query(`
      INSERT INTO submissions (
        id,
        challenge_slug,
        language,
        code,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'submission-1',
      'js-bugfix-add',
      'javascript',
      'export const sum = () => 0;',
      'queued',
      '2026-08-06T00:00:00.000Z',
      '2026-08-06T00:00:00.000Z'
    ]);

    await assert.rejects(
      pool.query(`
        INSERT INTO queue_outbox (
          id,
          submission_id,
          grading_attempt,
          message_json,
          status,
          created_at,
          updated_at,
          publish_attempts
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'outbox-invalid',
        'submission-1',
        1,
        '{}',
        'invalid',
        '2026-08-06T00:00:00.000Z',
        '2026-08-06T00:00:00.000Z',
        0
      ]),
      /check constraint/i
    );
  });
});

test('PostgreSQL migration失敗時にschema変更とhistoryをrollbackする', { skip: skipReason }, async () => {
  await withTestSchema(async ({ pool, schema }) => {
    await runPostgresqlMigrations({ pool, schema });

    await assert.rejects(
      runPostgresqlMigrations({
        pool,
        schema,
        migrations: createFailureManifest()
      }),
      /Migration 4 'failure_probe' failed/
    );

    const relation = await pool.query(
      'SELECT to_regclass($1) AS relation',
      ['migration_failure_probe']
    );
    assert.equal(relation.rows[0].relation, null);

    const history = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    assert.deepEqual(history.rows.map(({ version }) => version), [1, 2, 3]);
  });
});

test('PostgreSQL applied checksum driftを適用前に拒否する', { skip: skipReason }, async () => {
  await withTestSchema(async ({ pool, schema }) => {
    await runPostgresqlMigrations({ pool, schema });
    await pool.query(
      "UPDATE schema_migrations SET checksum = 'drifted' WHERE version = 2"
    );

    await assert.rejects(
      planPostgresqlMigrations({ pool, schema }),
      /checksum drift detected/
    );
  });
});

test('同一databaseで別Migratorがlock保持中の場合は即時拒否する', { skip: skipReason }, async () => {
  await withTestSchema(async ({ pool, schema }) => {
    const blocker = await pool.connect();
    try {
      await blocker.query(
        'SELECT pg_advisory_lock($1, $2)',
        POSTGRESQL_MIGRATION_LOCK_IDS
      );

      await assert.rejects(
        runPostgresqlMigrations({ pool, schema }),
        { name: 'PostgresqlMigrationLockError' }
      );

      const relation = await pool.query(
        'SELECT to_regclass($1) AS relation',
        ['schema_migrations']
      );
      assert.equal(relation.rows[0].relation, null);
    } finally {
      await blocker.query(
        'SELECT pg_advisory_unlock($1, $2)',
        POSTGRESQL_MIGRATION_LOCK_IDS
      );
      blocker.release();
    }
  });
});
