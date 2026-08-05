import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { migrationManifest } from '../../apps/api/src/db/migrations/migration-manifest.mjs';
import {
  planSqliteMigrations,
  runSqliteMigrations
} from '../../apps/api/src/db/migrations/sqlite-migration-runner.mjs';

test('SQLite migration runnerは未適用migrationを昇順適用して再実行をno-opにする', () => {
  const database = new DatabaseSync(':memory:');
  const initialPlan = planSqliteMigrations({ database });

  assert.deepEqual(initialPlan.applied, []);
  assert.deepEqual(initialPlan.pending.map((migration) => migration.version), [1, 2, 3]);
  assert.equal(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(),
    undefined
  );

  const first = runSqliteMigrations({
    database,
    now: () => new Date('2026-08-05T00:00:00.000Z')
  });
  assert.deepEqual(first.appliedNow.map((migration) => migration.version), [1, 2, 3]);
  assert.deepEqual(first.pending, []);

  const second = runSqliteMigrations({ database });
  assert.deepEqual(second.appliedNow, []);
  assert.deepEqual(second.applied.map((migration) => migration.version), [1, 2, 3]);

  const history = database.prepare(`
    SELECT version, name, provider, applied_at
    FROM schema_migrations
    ORDER BY version
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(history, migrationManifest.map((migration) => ({
    version: migration.version,
    name: migration.name,
    provider: 'sqlite',
    applied_at: '2026-08-05T00:00:00.000Z'
  })));

  database.close();
});

test('SQLite migration runnerはchecksum driftを適用前に拒否する', () => {
  const database = new DatabaseSync(':memory:');
  runSqliteMigrations({ database });
  database.prepare(`
    UPDATE schema_migrations
    SET checksum = ?
    WHERE version = 2
  `).run('0'.repeat(64));

  assert.throws(
    () => runSqliteMigrations({ database }),
    /checksum drift detected/
  );

  assert.deepEqual(
    database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    [1, 2, 3]
  );
  database.close();
});

test('SQLite migration失敗時はschema変更と履歴記録をrollbackする', () => {
  const database = new DatabaseSync(':memory:');
  const failingManifest = [
    {
      version: 1,
      name: 'create_base',
      providers: {
        sqlite: {
          steps: [{ type: 'sql', sql: 'CREATE TABLE stable_table (id TEXT PRIMARY KEY);' }]
        },
        postgresql: {
          steps: [{ type: 'sql', sql: 'CREATE TABLE stable_table (id TEXT PRIMARY KEY);' }]
        }
      }
    },
    {
      version: 2,
      name: 'failing_change',
      providers: {
        sqlite: {
          steps: [{
            type: 'sql',
            sql: 'CREATE TABLE should_rollback (id TEXT PRIMARY KEY); THIS IS NOT SQL;'
          }]
        },
        postgresql: {
          steps: [{ type: 'sql', sql: 'CREATE TABLE should_rollback (id TEXT PRIMARY KEY);' }]
        }
      }
    }
  ];

  assert.throws(
    () => runSqliteMigrations({ database, migrations: failingManifest }),
    /Migration 2 'failing_change' failed/
  );

  assert.ok(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stable_table'").get()
  );
  assert.equal(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").get(),
    undefined
  );
  assert.deepEqual(
    database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    [1]
  );

  database.close();
});
