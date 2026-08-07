import { MIGRATION_TABLE_NAME } from './migration-contract.mjs';

export const SQLITE_MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE_NAME} (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

export const POSTGRESQL_MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE_NAME} (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;
