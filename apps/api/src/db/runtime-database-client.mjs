import { createSqliteDatabaseClient } from './adapters/sqlite-database-client.mjs';
import { getDb } from './database.mjs';

let runtimeDatabaseClient;

/**
 * 現行runtimeのDatabaseClient境界。
 *
 * Production providerの切替は後続Issueでcomposition rootとして実施するため、
 * この段階では既存SQLite singletonだけをasync adapterで包む。
 */
export const getRuntimeDatabaseClient = () => {
  if (!runtimeDatabaseClient) {
    runtimeDatabaseClient = createSqliteDatabaseClient({
      database: getDb(),
      closeDatabase: false
    });
  }
  return runtimeDatabaseClient;
};
