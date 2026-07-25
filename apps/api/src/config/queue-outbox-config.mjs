const TRUE_VALUES = new Set(['1', 'true']);
const FALSE_VALUES = new Set(['0', 'false']);

const parseBoolean = (value, name, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new TypeError(`${name} must be 0, 1, false, or true.`);
};

const parsePositiveInteger = (value, name, defaultValue) => {
  const resolved = value === undefined || value === null || value === '' ? defaultValue : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return resolved;
};

export const loadQueueOutboxConfig = (env = process.env) => Object.freeze({
  enabled: parseBoolean(env.API_QUEUE_OUTBOX_ENABLED, 'API_QUEUE_OUTBOX_ENABLED', false),
  pollIntervalMs: parsePositiveInteger(
    env.API_QUEUE_OUTBOX_POLL_INTERVAL_MS,
    'API_QUEUE_OUTBOX_POLL_INTERVAL_MS',
    1000
  ),
  batchSize: parsePositiveInteger(
    env.API_QUEUE_OUTBOX_BATCH_SIZE,
    'API_QUEUE_OUTBOX_BATCH_SIZE',
    25
  )
});
