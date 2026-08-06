const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const SUPPORTED_SSL_MODES = new Set(['disable', 'verify-full']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const parseInteger = (value, {
  field,
  defaultValue,
  min,
  max
}) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${field} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
};

const parseConnectionUrl = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('POSTGRESQL_DATABASE_URL is required for the postgresql provider.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('POSTGRESQL_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('POSTGRESQL_DATABASE_URL must use the postgres or postgresql protocol.');
  }
  if (!url.username || !url.password || !url.hostname || url.pathname === '/' || url.pathname === '') {
    throw new Error('POSTGRESQL_DATABASE_URL must include username, password, host, and database name.');
  }

  return url;
};

export const loadPostgresqlConfig = (environment = process.env) => {
  const connectionString = environment.POSTGRESQL_DATABASE_URL?.trim();
  const url = parseConnectionUrl(connectionString);
  const sslMode = environment.POSTGRESQL_SSL_MODE?.trim().toLowerCase() || 'verify-full';
  if (!SUPPORTED_SSL_MODES.has(sslMode)) {
    throw new RangeError('POSTGRESQL_SSL_MODE must be disable or verify-full.');
  }

  if (sslMode === 'disable' && environment.NODE_ENV !== 'test' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('POSTGRESQL_SSL_MODE=disable is only allowed for localhost or NODE_ENV=test.');
  }

  const schema = environment.POSTGRESQL_SCHEMA?.trim() || 'public';
  if (!IDENTIFIER_PATTERN.test(schema)) {
    throw new Error('POSTGRESQL_SCHEMA must be a lowercase SQL identifier.');
  }

  const poolMax = parseInteger(environment.POSTGRESQL_POOL_MAX, {
    field: 'POSTGRESQL_POOL_MAX',
    defaultValue: 4,
    min: 1,
    max: 20
  });
  const connectionTimeoutMillis = parseInteger(environment.POSTGRESQL_CONNECTION_TIMEOUT_MS, {
    field: 'POSTGRESQL_CONNECTION_TIMEOUT_MS',
    defaultValue: 5000,
    min: 100,
    max: 60000
  });
  const idleTimeoutMillis = parseInteger(environment.POSTGRESQL_IDLE_TIMEOUT_MS, {
    field: 'POSTGRESQL_IDLE_TIMEOUT_MS',
    defaultValue: 1000,
    min: 0,
    max: 60000
  });

  return Object.freeze({
    connectionString,
    schema,
    sslMode,
    poolOptions: Object.freeze({
      connectionString,
      application_name: 'ai-code-dojo-migrator',
      max: poolMax,
      connectionTimeoutMillis,
      idleTimeoutMillis,
      options: `-c search_path=${schema}`,
      ssl: sslMode === 'verify-full'
        ? Object.freeze({ rejectUnauthorized: true })
        : false
    })
  });
};

export const createPostgresqlPool = async ({
  config = loadPostgresqlConfig(),
  PoolClass
} = {}) => {
  const ResolvedPool = PoolClass ?? (await import('pg')).Pool;
  if (typeof ResolvedPool !== 'function') {
    throw new TypeError('PoolClass must be a constructor.');
  }
  return new ResolvedPool(config.poolOptions);
};
