import { DatabaseSync } from 'node:sqlite';
import { createSqliteDatabaseClient } from '../../apps/api/src/db/adapters/sqlite-database-client.mjs';
import { registerDatabaseClientContract } from './helpers/database-client-contract.mjs';

registerDatabaseClientContract({
  name: 'SQLite database client',
  createClient: async () => createSqliteDatabaseClient({
    database: new DatabaseSync(':memory:')
  })
});
