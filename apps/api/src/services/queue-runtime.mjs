import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createHttpQueueProducer } from '../../../../packages/queue/src/http-queue-producer.mjs';
import { createQueueEventLogger } from '../../../../packages/queue/src/queue-event-logger.mjs';
import { enqueueSubmissionAttempt } from '../../../../packages/queue/src/submission-queue.mjs';
import { createSqsQueueProducer } from '../../../../packages/queue/src/sqs-queue-producer.mjs';
import { QUEUE_TRANSPORTS } from '../config/queue-transport-config.mjs';

const getDefaultWorkerUrl = () => process.env.RUNNER_API_BASE_URL ?? 'http://localhost:8081';
const defaultSqsClientFactory = (options) => new SQSClient(options);
const defaultSqsCommandFactory = (input) => new SendMessageCommand(input);
const defaultEventLoggerFactory = () => createQueueEventLogger({ service: 'api' });

export const createQueueRuntime = ({
  config,
  runnerApiBaseUrl = getDefaultWorkerUrl(),
  sqsClientFactory = defaultSqsClientFactory,
  sqsCommandFactory = defaultSqsCommandFactory,
  eventLoggerFactory = defaultEventLoggerFactory
}) => {
  if (!config || typeof config !== 'object') {
    throw new TypeError('queue transport config is required.');
  }
  if (![QUEUE_TRANSPORTS.HTTP, QUEUE_TRANSPORTS.SQS].includes(config.transport)) {
    throw new TypeError('queue transport config is invalid.');
  }
  if (typeof eventLoggerFactory !== 'function') {
    throw new TypeError('queue eventLoggerFactory is required.');
  }

  let sqsClient = null;
  if (config.transport === QUEUE_TRANSPORTS.SQS) {
    if (!config.sqs || typeof config.sqs !== 'object') {
      throw new TypeError('SQS runtime config is required.');
    }
    if (typeof sqsClientFactory !== 'function' || typeof sqsCommandFactory !== 'function') {
      throw new TypeError('SQS client and command factories are required.');
    }
    sqsClient = sqsClientFactory({ region: config.sqs.region });
    if (!sqsClient || typeof sqsClient.send !== 'function') {
      throw new TypeError('SQS client factory must return a client with send().');
    }
  }

  const enqueue = async (params = {}) => {
    const source = params.source ?? 'submission';
    const eventLogger = params.eventLogger ?? eventLoggerFactory();
    const queueProducer = config.transport === QUEUE_TRANSPORTS.SQS
      ? createSqsQueueProducer({
          client: sqsClient,
          commandFactory: sqsCommandFactory,
          queueUrl: config.sqs.queueUrl,
          queueType: config.sqs.queueType,
          source,
          eventLogger
        })
      : createHttpQueueProducer({
          baseUrl: runnerApiBaseUrl,
          source,
          eventLogger
        });

    return enqueueSubmissionAttempt({
      ...params,
      source,
      eventLogger,
      queueProducer
    });
  };

  const close = () => {
    if (!sqsClient || typeof sqsClient.destroy !== 'function') return false;
    try {
      sqsClient.destroy();
      return true;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    transport: config.transport,
    enqueue,
    close
  });
};
