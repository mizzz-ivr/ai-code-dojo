import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMigrationPlan,
  calculateMigrationChecksum,
  validateMigrationManifest
} from '../../apps/api/src/db/migrations/migration-contract.mjs';
import { migrationManifest } from '../../apps/api/src/db/migrations/migration-manifest.mjs';
import { POSTGRESQL_MIGRATION_TABLE_SQL } from '../../apps/api/src/db/migrations/migration-table-sql.mjs';

test('migration manifestはSQLite・PostgreSQLの連番schemaを満たす', () => {
  assert.equal(validateMigrationManifest(migrationManifest), migrationManifest);
  assert.deepEqual(migrationManifest.map((migration) => migration.version), [1, 2, 3]);

  for (const migration of migrationManifest) {
    const sqliteChecksum = calculateMigrationChecksum(migration, 'sqlite');
    const postgresqlChecksum = calculateMigrationChecksum(migration, 'postgresql');
    assert.match(sqliteChecksum, /^[a-f0-9]{64}$/);
    assert.match(postgresqlChecksum, /^[a-f0-9]{64}$/);
    assert.notEqual(sqliteChecksum, postgresqlChecksum);
  }
});

test('PostgreSQL schemaはSQLite固有構文を含まない', () => {
  const postgresqlSql = [
    POSTGRESQL_MIGRATION_TABLE_SQL,
    ...migrationManifest.flatMap((migration) =>
      migration.providers.postgresql.steps.map((step) => step.sql)
    )
  ].join('\n');

  assert.doesNotMatch(postgresqlSql, /\bPRAGMA\b/i);
  assert.doesNotMatch(postgresqlSql, /BEGIN\s+IMMEDIATE/i);
  assert.doesNotMatch(postgresqlSql, /INSERT\s+OR\b/i);
  assert.doesNotMatch(postgresqlSql, /AUTOINCREMENT/i);
  assert.doesNotMatch(postgresqlSql, /\?/);
  assert.match(postgresqlSql, /CREATE TABLE IF NOT EXISTS challenges/);
  assert.match(postgresqlSql, /CREATE TABLE IF NOT EXISTS challenge_versions/);
  assert.match(postgresqlSql, /CREATE TABLE IF NOT EXISTS submissions/);
  assert.match(postgresqlSql, /CREATE TABLE IF NOT EXISTS queue_outbox/);
  assert.match(postgresqlSql, /CREATE TABLE IF NOT EXISTS schema_migrations/);
});

test('migration manifestはversion gap・重複name・provider欠落を拒否する', () => {
  const clone = (value) => structuredClone(value);

  const gap = clone(migrationManifest);
  gap[1].version = 3;
  assert.throws(
    () => validateMigrationManifest(gap),
    /contiguous from 1/
  );

  const duplicateName = clone(migrationManifest);
  duplicateName[1].name = duplicateName[0].name;
  assert.throws(
    () => validateMigrationManifest(duplicateName),
    /Duplicate migration name/
  );

  const providerMissing = clone(migrationManifest);
  delete providerMissing[0].providers.postgresql;
  assert.throws(
    () => validateMigrationManifest(providerMissing),
    /missing postgresql steps/
  );
});

test('migration planはchecksum drift・provider mismatch・履歴gapを拒否する', () => {
  const appliedRows = migrationManifest.slice(0, 2).map((migration) => ({
    version: migration.version,
    name: migration.name,
    provider: 'sqlite',
    checksum: calculateMigrationChecksum(migration, 'sqlite'),
    applied_at: '2026-08-05T00:00:00.000Z'
  }));

  const plan = buildMigrationPlan({
    migrations: migrationManifest,
    provider: 'sqlite',
    appliedRows
  });
  assert.deepEqual(plan.pending.map((migration) => migration.version), [3]);

  assert.throws(
    () => buildMigrationPlan({
      migrations: migrationManifest,
      provider: 'sqlite',
      appliedRows: [{ ...appliedRows[0], checksum: '0'.repeat(64) }]
    }),
    /checksum drift/
  );

  assert.throws(
    () => buildMigrationPlan({
      migrations: migrationManifest,
      provider: 'sqlite',
      appliedRows: [{ ...appliedRows[0], provider: 'postgresql' }]
    }),
    /provider mismatch/
  );

  assert.throws(
    () => buildMigrationPlan({
      migrations: migrationManifest,
      provider: 'sqlite',
      appliedRows: [{ ...appliedRows[1] }]
    }),
    /history has a gap/
  );
});
