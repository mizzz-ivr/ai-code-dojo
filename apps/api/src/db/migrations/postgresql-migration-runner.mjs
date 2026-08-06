import {
  buildMigrationPlan,
  calculateMigrationChecksum,
  MIGRATION_TABLE_NAME,
  validateMigrationManifest
} from './migration-contract.mjs';
import { migrationManifest } from './migration-manifest.mjs';
import { POSTGRESQL_MIGRATION_TABLE_SQL } from './migration-table-sql.mjs';

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
export const POSTGRESQL_MIGRATION_LOCK_IDS = Object.freeze([1094992983, 1]);

const assertPool = (pool) => {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('pool must provide connect().');
  }
};

const assertConnection = (connection) => {
  if (!connection || typeof connection.query !== 'function' || typeof connection.release !== 'function') {
    throw new TypeError('pool.connect() must return query() and release().');
  }
};

const assertSchema = (schema) => {
  if (typeof schema !== 'string' || !IDENTIFIER_PATTERN.test(schema)) {
    throw new Error('schema must be a lowercase SQL identifier.');
  }
};

const setSearchPath = async (connection, schema) => {
  await connection.query("SELECT set_config('search_path', $1, false)", [schema]);
};

const migrationTableExists = async (connection) => {
  const result = await connection.query(
    'SELECT to_regclass($1) AS relation',
    [MIGRATION_TABLE_NAME]
  );
  return Boolean(result.rows?.[0]?.relation);
};

const readAppliedMigrations = async (connection) => {
  if (!await migrationTableExists(connection)) return [];
  const result = await connection.query(`
    SELECT version, name, provider, checksum, applied_at
    FROM ${MIGRATION_TABLE_NAME}
    ORDER BY version ASC
  `);
  return Array.isArray(result.rows) ? result.rows : [];
};

const buildPlanWithConnection = async ({ connection, migrations }) => buildMigrationPlan({
  migrations,
  provider: 'postgresql',
  appliedRows: await readAppliedMigrations(connection)
});

const toSafeMigrationSummary = (migration) => Object.freeze({
  version: migration.version,
  name: migration.name,
  provider: 'postgresql',
  checksum: calculateMigrationChecksum(migration, 'postgresql')
});

const validateTimestamp = (timestamp) => {
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
    throw new Error('now must return a valid Date.');
  }
  return timestamp.toISOString();
};

const acquireMigrationLock = async (connection) => {
  const result = await connection.query(
    'SELECT pg_try_advisory_lock($1, $2) AS acquired',
    POSTGRESQL_MIGRATION_LOCK_IDS
  );
  if (result.rows?.[0]?.acquired !== true) {
    const error = new Error('Another PostgreSQL migrator is already active.');
    error.name = 'PostgresqlMigrationLockError';
    throw error;
  }
};

const releaseMigrationLock = async (connection) => {
  await connection.query(
    'SELECT pg_advisory_unlock($1, $2)',
    POSTGRESQL_MIGRATION_LOCK_IDS
  );
};

export const planPostgresqlMigrations = async ({
  pool,
  schema = 'public',
  migrations = migrationManifest
}) => {
  assertPool(pool);
  assertSchema(schema);
  validateMigrationManifest(migrations);

  const connection = await pool.connect();
  assertConnection(connection);
  try {
    await setSearchPath(connection, schema);
    return await buildPlanWithConnection({ connection, migrations });
  } finally {
    connection.release();
  }
};

export const runPostgresqlMigrations = async ({
  pool,
  schema = 'public',
  migrations = migrationManifest,
  now = () => new Date()
}) => {
  assertPool(pool);
  assertSchema(schema);
  validateMigrationManifest(migrations);
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }

  const connection = await pool.connect();
  assertConnection(connection);
  let lockAcquired = false;

  try {
    await setSearchPath(connection, schema);
    await acquireMigrationLock(connection);
    lockAcquired = true;

    await connection.query(POSTGRESQL_MIGRATION_TABLE_SQL);
    const plan = await buildPlanWithConnection({ connection, migrations });
    const appliedNow = [];

    for (const pending of plan.pending) {
      const migration = migrations[pending.version - 1];
      const appliedAt = validateTimestamp(now());

      await connection.query('BEGIN');
      try {
        for (const step of migration.providers.postgresql.steps) {
          if (step.type !== 'sql') {
            throw new Error(`Unsupported PostgreSQL migration step '${step.type}'.`);
          }
          await connection.query(step.sql);
        }

        await connection.query(`
          INSERT INTO ${MIGRATION_TABLE_NAME} (
            version,
            name,
            provider,
            checksum,
            applied_at
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          migration.version,
          migration.name,
          'postgresql',
          pending.checksum,
          appliedAt
        ]);
        await connection.query('COMMIT');
        appliedNow.push(toSafeMigrationSummary(migration));
      } catch (error) {
        try {
          await connection.query('ROLLBACK');
        } catch {
          // Rollback failure must not hide the migration failure.
        }
        throw new Error(`Migration ${migration.version} '${migration.name}' failed.`, {
          cause: error
        });
      }
    }

    const finalPlan = await buildPlanWithConnection({ connection, migrations });
    return Object.freeze({
      provider: 'postgresql',
      appliedNow: Object.freeze(appliedNow),
      applied: finalPlan.applied,
      pending: finalPlan.pending
    });
  } finally {
    if (lockAcquired) {
      try {
        await releaseMigrationLock(connection);
      } catch {
        // Connection release still takes priority; session locks are released on disconnect.
      }
    }
    connection.release();
  }
};
