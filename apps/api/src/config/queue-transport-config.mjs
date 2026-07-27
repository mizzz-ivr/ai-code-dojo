import { SQS_QUEUE_TYPES } from '../../../../packages/queue/src/sqs-queue-producer.mjs';

export const QUEUE_TRANSPORTS = Object.freeze({
  HTTP: 'http',
  SQS: 'sqs'
});

const validTransports = new Set(Object.values(QUEUE_TRANSPORTS));
const validQueueTypes = new Set(Object.values(SQS_QUEUE_TYPES));
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

const parseRegion = (value) => {
  if (!isNonEmptyString(value)) {
    throw new TypeError('API_SQS_REGION is required when API_QUEUE_TRANSPORT=sqs.');
  }
  const region = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(region)) {
    throw new TypeError('API_SQS_REGION must be a valid AWS region identifier.');
  }
  return region;
};

const parseQueueUrl = (value, queueType) => {
  if (!isNonEmptyString(value)) {
    throw new TypeError('API_SQS_QUEUE_URL is required when API_QUEUE_TRANSPORT=sqs.');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError('API_SQS_QUEUE_URL must be an absolute HTTPS URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('API_SQS_QUEUE_URL must be an absolute HTTPS URL without credentials, query, or fragment.');
  }

  const queueName = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!queueName) {
    throw new TypeError('API_SQS_QUEUE_URL must include a queue name.');
  }

  const fifoQueue = queueName.endsWith('.fifo');
  if (queueType === SQS_QUEUE_TYPES.FIFO && !fifoQueue) {
    throw new TypeError('API_SQS_QUEUE_URL must end with .fifo when API_SQS_QUEUE_TYPE=fifo.');
  }
  if (queueType === SQS_QUEUE_TYPES.STANDARD && fifoQueue) {
    throw new TypeError('API_SQS_QUEUE_URL must not end with .fifo when API_SQS_QUEUE_TYPE=standard.');
  }

  return value.trim();
};

export const loadQueueTransportConfig = (
  env = process.env,
  { outboxEnabled = false } = {}
) => {
  const transport = parseEnum(
    env.API_QUEUE_TRANSPORT,
    'API_QUEUE_TRANSPORT',
    validTransports,
    QUEUE_TRANSPORTS.HTTP
  );

  if (transport === QUEUE_TRANSPORTS.HTTP) {
    return Object.freeze({ transport });
  }

  if (!outboxEnabled) {
    throw new TypeError('API_QUEUE_OUTBOX_ENABLED must be true when API_QUEUE_TRANSPORT=sqs.');
  }

  const queueType = parseEnum(
    env.API_SQS_QUEUE_TYPE,
    'API_SQS_QUEUE_TYPE',
    validQueueTypes,
    SQS_QUEUE_TYPES.STANDARD
  );
  const region = parseRegion(env.API_SQS_REGION);
  const queueUrl = parseQueueUrl(env.API_SQS_QUEUE_URL, queueType);

  return Object.freeze({
    transport,
    sqs: Object.freeze({ region, queueUrl, queueType })
  });
};
