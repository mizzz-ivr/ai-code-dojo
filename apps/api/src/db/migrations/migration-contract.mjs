import { createHash } from 'node:crypto';

export const SUPPORTED_DATABASE_PROVIDERS = Object.freeze(['sqlite', 'postgresql']);
export const MIGRATION_TABLE_NAME = 'schema_migrations';

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const DESTRUCTIVE_SQL_PATTERN = /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i;
const POSTGRESQL_FORBIDDEN_PATTERN = /\bPRAGMA\b|BEGIN\s+IMMEDIATE|INSERT\s+OR\b|AUTOINCREMENT|\?/i;
const SQLITE_FORBIDDEN_PATTERN = /\$\d+/;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
};

const assertIdentifier = (value, field) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} must be a lowercase SQL identifier.`);
  }
};

const assertSqlStep = (step, provider, context) => {
  if (typeof step.sql !== 'string' || step.sql.trim() === '') {
    throw new Error(`${context} SQL must be a non-empty string.`);
  }
  if (DESTRUCTIVE_SQL_PATTERN.test(step.sql)) {
    throw new Error(`${context} contains a destructive SQL statement.`);
  }
  if (provider === 'postgresql' && POSTGRESQL_FORBIDDEN_PATTERN.test(step.sql)) {
    throw new Error(`${context} contains SQLite-specific or positional-unsafe SQL.`);
  }
  if (provider === 'sqlite' && SQLITE_FORBIDDEN_PATTERN.test(step.sql)) {
    throw new Error(`${context} contains a PostgreSQL positional placeholder.`);
  }
};

const assertStep = (step, provider, context) => {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error(`${context} must be an object.`);
  }
  if (step.type === 'sql') {
    assertSqlStep(step, provider, context);
    return;
  }
  if (step.type === 'addColumnIfMissing' && provider === 'sqlite') {
    assertIdentifier(step.table, `${context}.table`);
    assertIdentifier(step.column, `${context}.column`);
    if (typeof step.definition !== 'string' || step.definition.trim() === '') {
      throw new Error(`${context}.definition must be a non-empty string.`);
    }
    if (DESTRUCTIVE_SQL_PATTERN.test(step.definition)) {
      throw new Error(`${context}.definition contains destructive SQL.`);
    }
    return;
  }
  throw new Error(`${context} has unsupported step type '${step.type}'.`);
};

export const validateMigrationManifest = (migrations, {
  requiredProviders = SUPPORTED_DATABASE_PROVIDERS
} = {}) => {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error('Migration manifest must contain at least one migration.');
  }

  const names = new Set();
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (!migration || typeof migration !== 'object' || Array.isArray(migration)) {
      throw new Error(`Migration ${expectedVersion} must be an object.`);
    }
    if (migration.version !== expectedVersion) {
      throw new Error(`Migration versions must be contiguous from 1. Expected ${expectedVersion}.`);
    }
    if (typeof migration.name !== 'string' || !IDENTIFIER_PATTERN.test(migration.name)) {
      throw new Error(`Migration ${migration.version} name must be a lowercase identifier.`);
    }
    if (names.has(migration.name)) {
      throw new Error(`Duplicate migration name '${migration.name}'.`);
    }
    names.add(migration.name);

    for (const provider of requiredProviders) {
      if (!SUPPORTED_DATABASE_PROVIDERS.includes(provider)) {
        throw new Error(`Unsupported required provider '${provider}'.`);
      }
      const definition = migration.providers?.[provider];
      if (!definition || !Array.isArray(definition.steps) || definition.steps.length === 0) {
        throw new Error(`Migration ${migration.version} is missing ${provider} steps.`);
      }
      definition.steps.forEach((step, stepIndex) => {
        assertStep(step, provider, `Migration ${migration.version} ${provider} step ${stepIndex + 1}`);
      });
    }
  });

  return migrations;
};

export const calculateMigrationChecksum = (migration, provider) => {
  if (!SUPPORTED_DATABASE_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported database provider '${provider}'.`);
  }
  const definition = migration?.providers?.[provider];
  if (!definition) {
    throw new Error(`Migration ${migration?.version ?? 'unknown'} does not support ${provider}.`);
  }
  const canonical = canonicalize({
    version: migration.version,
    name: migration.name,
    provider,
    steps: definition.steps
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const normalizeAppliedRow = (row) => ({
  version: Number(row.version),
  name: String(row.name),
  provider: String(row.provider),
  checksum: String(row.checksum),
  appliedAt: String(row.applied_at ?? row.appliedAt ?? '')
});

export const buildMigrationPlan = ({ migrations, provider, appliedRows = [] }) => {
  validateMigrationManifest(migrations);
  if (!SUPPORTED_DATABASE_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported database provider '${provider}'.`);
  }
  if (!Array.isArray(appliedRows)) {
    throw new TypeError('appliedRows must be an array.');
  }

  const applied = appliedRows.map(normalizeAppliedRow);
  applied.forEach((row, index) => {
    const expectedVersion = index + 1;
    if (row.version !== expectedVersion) {
      throw new Error(`Applied migration history has a gap at version ${expectedVersion}.`);
    }
    const migration = migrations[index];
    if (!migration) {
      throw new Error(`Applied migration ${row.version} is not present in the manifest.`);
    }
    if (row.name !== migration.name) {
      throw new Error(`Applied migration ${row.version} name drift detected.`);
    }
    if (row.provider !== provider) {
      throw new Error(`Applied migration ${row.version} provider mismatch.`);
    }
    const expectedChecksum = calculateMigrationChecksum(migration, provider);
    if (row.checksum !== expectedChecksum) {
      throw new Error(`Applied migration ${row.version} checksum drift detected.`);
    }
  });

  const pending = migrations.slice(applied.length).map((migration) => ({
    version: migration.version,
    name: migration.name,
    provider,
    checksum: calculateMigrationChecksum(migration, provider)
  }));

  return Object.freeze({
    provider,
    applied: Object.freeze(applied),
    pending: Object.freeze(pending)
  });
};
