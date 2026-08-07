import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMigrationChecksum } from '../../apps/api/src/db/migrations/migration-contract.mjs';
import { runPostgresqlMigrations } from '../../apps/api/src/db/migrations/postgresql-migration-runner.mjs';

const migration = {
  version: 1,
  name: 'lifecycle_probe',
  providers: {
    sqlite: {
      steps: [
        { type: 'sql', sql: 'CREATE TABLE lifecycle_probe (id INTEGER PRIMARY KEY);' }
      ]
    },
    postgresql: {
      steps: [
        { type: 'sql', sql: 'CREATE TABLE lifecycle_probe (id INTEGER PRIMARY KEY);' }
      ]
    }
  }
};

test('advisory unlock失敗時はlock保持connectionをpoolへ戻さず破棄する', async () => {
  const checksum = calculateMigrationChecksum(migration, 'postgresql');
  let historyInserted = false;
  let releasedWithDestroy;

  const connection = {
    query: async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.includes("set_config('search_path'")) return { rows: [] };
      if (normalized.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (normalized.includes('pg_advisory_unlock')) {
        throw new Error('unlock failed');
      }
      if (normalized.includes('to_regclass')) {
        return { rows: [{ relation: historyInserted ? 'schema_migrations' : null }] };
      }
      if (normalized.startsWith('SELECT version, name, provider, checksum, applied_at')) {
        return {
          rows: [{
            version: 1,
            name: migration.name,
            provider: 'postgresql',
            checksum,
            applied_at: '2026-08-06T00:00:00.000Z'
          }]
        };
      }
      if (normalized.startsWith('INSERT INTO schema_migrations')) {
        historyInserted = true;
        return { rowCount: 1, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
    release: (destroy) => {
      releasedWithDestroy = destroy;
    }
  };
  const pool = {
    connect: async () => connection
  };

  const result = await runPostgresqlMigrations({
    pool,
    migrations: [migration],
    now: () => new Date('2026-08-06T00:00:00.000Z')
  });

  assert.deepEqual(result.appliedNow.map(({ version }) => version), [1]);
  assert.equal(releasedWithDestroy, true);
});
