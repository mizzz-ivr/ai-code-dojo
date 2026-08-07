import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createAdminChallengeRepository } from '../../apps/api/src/repositories/admin-challenge-repository.mjs';
import { createPostgresqlDatabaseClient } from '../../apps/api/src/db/adapters/postgresql-database-client.mjs';
import { runPostgresqlMigrations } from '../../apps/api/src/db/migrations/postgresql-migration-runner.mjs';
import {
  createPostgresqlPool,
  loadPostgresqlConfig
} from '../../apps/api/src/db/postgresql/postgresql-config.mjs';
import { registerAdminChallengeRepositoryContract } from '../unit/helpers/admin-challenge-repository-contract.mjs';

const connectionString = process.env.POSTGRESQL_TEST_DATABASE_URL;

if (!connectionString) {
  test('実PostgreSQL Admin Challenge Repository contract', {
    skip: 'POSTGRESQL_TEST_DATABASE_URL is not configured.'
  }, () => {});
} else {
  const adminPool = new Pool({
    connectionString,
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 5000
  });
  const activeSchemas = new Set();

  const createHarness = async () => {
    const schema = `dojo_admin_challenge_${randomUUID().replaceAll('-', '')}`;
    activeSchemas.add(schema);
    await adminPool.query(`CREATE SCHEMA ${schema}`);

    const config = loadPostgresqlConfig({
      NODE_ENV: 'test',
      POSTGRESQL_DATABASE_URL: connectionString,
      POSTGRESQL_SSL_MODE: 'disable',
      POSTGRESQL_SCHEMA: schema,
      POSTGRESQL_POOL_MAX: '3'
    });
    const pool = await createPostgresqlPool({ config });
    await runPostgresqlMigrations({ pool, schema });

    const databaseClient = createPostgresqlDatabaseClient({ pool });
    const repository = createAdminChallengeRepository({ databaseClient });
    let closed = false;

    return Object.freeze({
      repository,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await databaseClient.close();
        } finally {
          await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
          activeSchemas.delete(schema);
        }
      }
    });
  };

  registerAdminChallengeRepositoryContract({
    name: '実PostgreSQL Admin Challenge Repository',
    createHarness
  });

  test('同一ChallengeへのVersion同時追加を連番として直列化する', async () => {
    const harness = await createHarness();
    try {
      const created = await harness.repository.createAdminChallenge({
        slug: 'concurrent-version-contract',
        versionData: {
          metadata: { title: 'v1' },
          hiddenTests: ['v1-hidden']
        }
      });

      const [version2Id, version3Id] = await Promise.all([
        harness.repository.createAdminChallengeVersion(created.challengeId, {
          metadata: { title: 'concurrent-a' },
          hiddenTests: ['a-hidden']
        }),
        harness.repository.createAdminChallengeVersion(created.challengeId, {
          metadata: { title: 'concurrent-b' },
          hiddenTests: ['b-hidden']
        })
      ]);

      assert.ok(version2Id);
      assert.ok(version3Id);
      assert.notEqual(version2Id, version3Id);

      const detail = await harness.repository.getAdminChallengeById(created.challengeId);
      assert.deepEqual(detail.versions.map(({ version }) => version), [3, 2, 1]);
      assert.equal(detail.currentVersionId, detail.versions[0].id);
    } finally {
      await harness.close();
    }
  });

  after(async () => {
    for (const schema of activeSchemas) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await adminPool.end();
  });
}
