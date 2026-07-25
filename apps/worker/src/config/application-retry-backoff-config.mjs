const DEFAULT_APPLICATION_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_APPLICATION_RETRY_MAX_DELAY_MS = 60_000;

const parsePositiveInteger = (rawValue, fallback, name) => {
  if (rawValue === undefined) return fallback;

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
};

export const getApplicationRetryBackoffConfig = (env = process.env) => {
  const enabled = env.WORKER_APPLICATION_RETRY_BACKOFF_ENABLED === '1';
  const baseDelayMs = parsePositiveInteger(
    env.WORKER_APPLICATION_RETRY_BASE_DELAY_MS,
    DEFAULT_APPLICATION_RETRY_BASE_DELAY_MS,
    'WORKER_APPLICATION_RETRY_BASE_DELAY_MS'
  );
  const maxDelayMs = parsePositiveInteger(
    env.WORKER_APPLICATION_RETRY_MAX_DELAY_MS,
    DEFAULT_APPLICATION_RETRY_MAX_DELAY_MS,
    'WORKER_APPLICATION_RETRY_MAX_DELAY_MS'
  );

  if (maxDelayMs < baseDelayMs) {
    throw new Error('WORKER_APPLICATION_RETRY_MAX_DELAY_MS must be greater than or equal to WORKER_APPLICATION_RETRY_BASE_DELAY_MS.');
  }

  return {
    enabled,
    baseDelayMs,
    maxDelayMs
  };
};
