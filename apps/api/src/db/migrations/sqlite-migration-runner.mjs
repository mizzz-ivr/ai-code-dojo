import {
  buildMigrationPlan,
  calculateMigrationChecksum,
  MIGRATION_TABLE_NAME,
  validateMigrationManifest
} from './migration-contract.mjs';
import { migrationManifest } from './migration-manifest.mjs';

export const SQLITE_MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE_NAME} (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

export const POSTGRESQL_MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE_NAME} (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

const assertDatabase = (database) => {
  if (!database || typeof database.prepare !== 'function' || typeof database.exec !== 'function') {
    throw new TypeError('database must provide prepare() and exec().');
  }
};

const migrationTableExists = (database) => Boolean(
  database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATION_TABLE_NAME)
);

const readAppliedMigrations = (database) => {
  if (!migrationTableExists(database)) return [];
  return database
    .prepare(`
      SELECT version, name, provider, checksum, applied_at
      FROM ${MIGRATION_TABLE_NAME}
      ORDER BY version ASC
    `)
    .all();
};

const executeSqliteStep = (database, step) => {
  if (step.type === 'sql') {
    database.exec(step.sql);
    return;
  }

  if (step.type === 'addColumnIfMissing') {
    const columns = database.prepare(`PRAGMA table_info(${step.table})`).all();
    if (columns.some((column) => column.name === step.column)) return;
    database.exec(`ALTER TABLE ${step.table} ADD COLUMN ${step.column} ${step.definition}`);
    return;
  }

  throw new Error(`Unsupported SQLite migration step '${step.type}'.`);
};

const toSafeMigrationSummary = (migration, provider) => Object.freeze({
  version: migration.version,
  name: migration.name,
  provider,
  checksum: calculateMigrationChecksum(migration, provider)
});

export const planSqliteMigrations = ({
  database,
  migrations = migrationManifest
}) => {
  assertDatabase(database);
  validateMigrationManifest(migrations);
  return buildMigrationPlan({
    migrations,
    provider: 'sqlite',
    appliedRows: readAppliedMigrations(database)
  });
};

export const runSqliteMigrations = ({
  database,
  migrations = migrationManifest,
  now = () => new Date()
}) => {
  assertDatabase(database);
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }

  const plan = planSqliteMigrations({ database, migrations });
  database.exec(SQLITE_MIGRATION_TABLE_SQL);

  const appliedNow = [];
  for (const pending of plan.pending) {
    const migration = migrations[pending.version - 1];
    const timestamp = now();
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
      throw new Error('now must return a valid Date.');
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      for (const step of migration.providers.sqlite.steps) {
        executeSqliteStep(database, step);
      }
      database.prepare(`
        INSERT INTO ${MIGRATION_TABLE_NAME} (
          version,
          name,
          provider,
          checksum,
          applied_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        migration.version,
        migration.name,
        'sqlite',
        pending.checksum,
        timestamp.toISOString()
      );
      database.exec('COMMIT');
      appliedNow.push(toSafeMigrationSummary(migration, 'sqlite'));
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Rollback failure must not hide the migration failure.
      }
      throw new Error(`Migration ${migration.version} '${migration.name}' failed.`, {
        cause: error
      });
    }
  }

  const finalPlan = planSqliteMigrations({ database, migrations });
  return Object.freeze({
    provider: 'sqlite',
    appliedNow: Object.freeze(appliedNow),
    applied: finalPlan.applied,
    pending: finalPlan.pending
  });
};
