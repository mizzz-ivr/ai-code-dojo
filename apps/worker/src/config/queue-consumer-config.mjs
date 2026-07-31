import { SQS_QUEUE_TYPES } from '../../../../packages/queue/src/sqs-queue-producer.mjs';

export const WORKER_QUEUE_CONSUMERS = Object.freeze({
  HTTP: 'http',
  SQS: 'sqs'
});

const DEFAULT_POLL_ERROR_DELAY_MS = 1_000;
const validConsumers = new Set(Object.values(WORKER_QUEUE_CONSUMERS));
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const parseEnum = (value, name, allowedValues, defaultValue) => {
  const resolved = value === undefined || value === null || value === ''
    ? defaultValue
    : String(value).toLowerCase();
  if (!allowedValues.has(resolved)) {
    throw new TypeError(`${name} must be one of: ${[...allowedValues].join(', ')}.`);
  }
  return resolved;
};

const parseRequiredInteger = (value, name, { min, max }) => {
  if (value === undefined || value === null || value === '') {
    throw new TypeError(`${name} is required when WORKER_QUEUE_CONSUMER=sqs.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
};

const parseOptionalPositiveInteger = (value, name, defaultValue) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return parsed;
};

const parseRegion = (value) => {
  if (!isNonEmptyString(value)) {
    throw new TypeError('WORKER_SQS_REGION is required when WORKER_QUEUE_CONSUMER=sqs.');
  }
  const region = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(region)) {
    throw new TypeError('WORKER_SQS_REGION must be a valid AWS region identifier.');
  }
  return region;
};

const parseQueueUrl = (value) => {
  if (!isNonEmptyString(value)) {
    throw new TypeError('WORKER_SQS_QUEUE_URL is required when WORKER_QUEUE_CONSUMER=sqs.');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError('WORKER_SQS_QUEUE_URL must be an absolute HTTPS URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('WORKER_SQS_QUEUE_URL must be an absolute HTTPS URL without credentials, query, or fragment.');
  }

  const queueName = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!queueName) {
    throw new TypeError('WORKER_SQS_QUEUE_URL must include a queue name.');
  }

  return Object.freeze({
    queueUrl: value.trim(),
    queueType: queueName.endsWith('.fifo')
      ? SQS_QUEUE_TYPES.FIFO
      : SQS_QUEUE_TYPES.STANDARD
  });
};

export const loadWorkerQueueConsumerConfig = (env = process.env) => {
  const transport = parseEnum(
    env.WORKER_QUEUE_CONSUMER,
    'WORKER_QUEUE_CONSUMER',
    validConsumers,
    WORKER_QUEUE_CONSUMERS.HTTP
  );

  if (transport === WORKER_QUEUE_CONSUMERS.HTTP) {
    return Object.freeze({ transport });
  }

  const waitTimeSeconds = parseRequiredInteger(
    env.WORKER_SQS_WAIT_TIME_SECONDS,
    'WORKER_SQS_WAIT_TIME_SECONDS',
    { min: 1, max: 20 }
  );
  const visibilityTimeoutSeconds = parseRequiredInteger(
    env.WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS,
    'WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS',
    { min: 1, max: 43_200 }
  );
  const visibilityHeartbeatSeconds = parseRequiredInteger(
    env.WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS,
    'WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS',
    { min: 1, max: 43_200 }
  );

  if (visibilityHeartbeatSeconds * 3 > visibilityTimeoutSeconds) {
    throw new RangeError(
      'WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS must be at most one third of WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS.'
    );
  }

  const queue = parseQueueUrl(env.WORKER_SQS_QUEUE_URL);

  return Object.freeze({
    transport,
    sqs: Object.freeze({
      region: parseRegion(env.WORKER_SQS_REGION),
      queueUrl: queue.queueUrl,
      queueType: queue.queueType,
      waitTimeSeconds,
      visibilityTimeoutSeconds,
      visibilityHeartbeatSeconds,
      pollErrorDelayMs: parseOptionalPositiveInteger(
        env.WORKER_SQS_POLL_ERROR_DELAY_MS,
        'WORKER_SQS_POLL_ERROR_DELAY_MS',
        DEFAULT_POLL_ERROR_DELAY_MS
      )
    })
  });
};
