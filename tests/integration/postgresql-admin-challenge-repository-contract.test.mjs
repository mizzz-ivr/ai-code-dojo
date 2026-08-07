import { after, test } from 'node:test';
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

  after(async () => {
    for (const schema of activeSchemas) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await adminPool.end();
  });
}
