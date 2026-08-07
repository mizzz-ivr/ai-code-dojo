import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresqlDatabaseClient } from '../../apps/api/src/db/adapters/postgresql-database-client.mjs';
import {
  createPostgresqlPool,
  loadPostgresqlConfig
} from '../../apps/api/src/db/postgresql/postgresql-config.mjs';
import { registerDatabaseClientContract } from '../unit/helpers/database-client-contract.mjs';

const connectionString = process.env.POSTGRESQL_TEST_DATABASE_URL;

if (!connectionString) {
  test('実PostgreSQL DatabaseClient contract', {
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

  const createClient = async () => {
    const schema = `dojo_contract_${randomUUID().replaceAll('-', '')}`;
    activeSchemas.add(schema);
    await adminPool.query(`CREATE SCHEMA ${schema}`);

    const config = loadPostgresqlConfig({
      NODE_ENV: 'test',
      POSTGRESQL_DATABASE_URL: connectionString,
      POSTGRESQL_SSL_MODE: 'disable',
      POSTGRESQL_SCHEMA: schema,
      POSTGRESQL_POOL_MAX: '2'
    });
    const pool = await createPostgresqlPool({ config });
    const client = createPostgresqlDatabaseClient({ pool });
    let closed = false;

    return Object.freeze({
      query: client.query,
      execute: client.execute,
      transaction: client.transaction,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await client.close();
        } finally {
          await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
          activeSchemas.delete(schema);
        }
      }
    });
  };

  registerDatabaseClientContract({
    name: '実PostgreSQL database client',
    createClient
  });

  after(async () => {
    for (const schema of activeSchemas) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await adminPool.end();
  });
}
