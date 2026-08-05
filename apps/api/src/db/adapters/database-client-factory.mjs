import { createPostgresqlDatabaseClient } from './postgresql-database-client.mjs';
import { createSqliteDatabaseClient } from './sqlite-database-client.mjs';

const SUPPORTED_PROVIDERS = new Set(['sqlite', 'postgresql']);

export const loadDatabaseProvider = (environment = process.env) => {
  const provider = environment.DB_PROVIDER?.trim().toLowerCase() || 'sqlite';
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new RangeError('DB_PROVIDER must be sqlite or postgresql.');
  }
  return provider;
};

export const createDatabaseClient = ({
  environment = process.env,
  sqliteDatabase,
  postgresqlPool,
  closeSqliteDatabase = true
} = {}) => {
  const provider = loadDatabaseProvider(environment);

  if (provider === 'sqlite') {
    return createSqliteDatabaseClient({
      database: sqliteDatabase,
      closeDatabase: closeSqliteDatabase
    });
  }

  return createPostgresqlDatabaseClient({ pool: postgresqlPool });
};
