import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs';
import { createNoopQueueEventLogger } from '../../../../packages/queue/src/queue-event-logger.mjs';
import { WORKER_QUEUE_CONSUMERS } from '../config/queue-consumer-config.mjs';
import { createSqsQueueConsumer } from './sqs-queue-consumer.mjs';

const defaultSqsClientFactory = (options) => new SQSClient(options);
const defaultReceiveCommandFactory = (input) => new ReceiveMessageCommand(input);
const defaultDeleteCommandFactory = (input) => new DeleteMessageCommand(input);
const defaultChangeVisibilityCommandFactory = (input) => new ChangeMessageVisibilityCommand(input);

export const createWorkerQueueConsumerRuntime = ({
  config,
  processMessage,
  eventLogger = createNoopQueueEventLogger(),
  sqsClientFactory = defaultSqsClientFactory,
  receiveCommandFactory = defaultReceiveCommandFactory,
  deleteCommandFactory = defaultDeleteCommandFactory,
  changeVisibilityCommandFactory = defaultChangeVisibilityCommandFactory,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  sleepFn
}) => {
  if (!config || typeof config !== 'object') {
    throw new TypeError('worker queue consumer config is required.');
  }
  if (![WORKER_QUEUE_CONSUMERS.HTTP, WORKER_QUEUE_CONSUMERS.SQS].includes(config.transport)) {
    throw new TypeError('worker queue consumer config is invalid.');
  }
  if (typeof processMessage !== 'function') {
    throw new TypeError('worker queue consumer processMessage is required.');
  }

  if (config.transport === WORKER_QUEUE_CONSUMERS.HTTP) {
    return Object.freeze({
      transport: config.transport,
      start: () => false,
      close: async () => false
    });
  }

  if (!config.sqs || typeof config.sqs !== 'object') {
    throw new TypeError('worker SQS consumer config is required.');
  }
  if (typeof sqsClientFactory !== 'function') {
    throw new TypeError('worker SQS client factory is required.');
  }

  const client = sqsClientFactory({ region: config.sqs.region });
  if (!client || typeof client.send !== 'function') {
    throw new TypeError('worker SQS client factory must return a client with send().');
  }

  const consumer = createSqsQueueConsumer({
    client,
    queueUrl: config.sqs.queueUrl,
    waitTimeSeconds: config.sqs.waitTimeSeconds,
    visibilityTimeoutSeconds: config.sqs.visibilityTimeoutSeconds,
    visibilityHeartbeatSeconds: config.sqs.visibilityHeartbeatSeconds,
    pollErrorDelayMs: config.sqs.pollErrorDelayMs,
    processMessage,
    receiveCommandFactory,
    deleteCommandFactory,
    changeVisibilityCommandFactory,
    eventLogger,
    setIntervalFn,
    clearIntervalFn,
    ...(sleepFn ? { sleepFn } : {})
  });

  let closed = false;
  const close = async () => {
    if (closed) return false;
    closed = true;

    const stopPromise = consumer.stop();
    try {
      client.destroy?.();
    } catch {
      // Shutdown is best effort. Credentials, endpoints, and raw SDK errors are not logged here.
    }
    await stopPromise;
    return true;
  };

  return Object.freeze({
    transport: config.transport,
    start: consumer.start,
    close
  });
};
