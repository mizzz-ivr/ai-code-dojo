import { createPostgresqlDatabaseClient } from '../../apps/api/src/db/adapters/postgresql-database-client.mjs';
import { registerDatabaseClientContract } from './helpers/database-client-contract.mjs';
import { createFakePostgresqlPool } from './helpers/fake-postgresql-pool.mjs';

registerDatabaseClientContract({
  name: 'PostgreSQL database client',
  createClient: async () => createPostgresqlDatabaseClient({
    pool: createFakePostgresqlPool()
  })
});
