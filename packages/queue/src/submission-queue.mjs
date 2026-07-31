import { buildSubmissionQueueMessage } from './message-contract.mjs';
import { createHttpQueueProducer } from './http-queue-producer.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from './queue-event-logger.mjs';

const getDefaultWorkerUrl = () => process.env.RUNNER_API_BASE_URL ?? 'http://localhost:8081';

let defaultQueueProducerFactory = null;

export const setDefaultSubmissionQueueProducerFactory = (factory) => {
  if (factory !== null && typeof factory !== 'function') {
    throw new TypeError('default queue producer factory must be a function or null.');
  }

  const previousFactory = defaultQueueProducerFactory;
  defaultQueueProducerFactory = factory;
  let active = true;

  return () => {
    if (!active) return false;
    active = false;
    if (defaultQueueProducerFactory !== factory) return false;
    defaultQueueProducerFactory = previousFactory;
    return true;
  };
};

const createDefaultQueueProducer = ({ runnerApiBaseUrl, eventLogger, source }) => {
  if (defaultQueueProducerFactory) {
    const producer = defaultQueueProducerFactory({ eventLogger, source });
    if (!producer || typeof producer.enqueue !== 'function') {
      throw new TypeError('default queue producer factory must return a producer with enqueue().');
    }
    return producer;
  }

  return createHttpQueueProducer({
    baseUrl: runnerApiBaseUrl,
    eventLogger,
    source
  });
};

export const enqueueSubmissionAttempt = async ({
  submissionId,
  gradingAttempt,
  attemptIdempotencyKey,
  correlationId,
  runnerApiBaseUrl = getDefaultWorkerUrl(),
  queueProducer,
  eventLogger = createQueueEventLogger({ service: 'api' }),
  source = 'submission',
  transport = 'http'
}) => {
  let message;
  try {
    message = buildSubmissionQueueMessage({
      submissionId,
      gradingAttempt,
      attemptIdempotencyKey,
      correlationId
    });
  } catch (error) {
    eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
      transport,
      source,
      submissionId,
      gradingAttempt,
      correlationId,
      outcome: 'rejected',
      reason: 'message_build_failed',
      errorType: error?.name ?? 'TypeError'
    });
    return false;
  }

  let producer;
  try {
    producer = queueProducer ?? createDefaultQueueProducer({
      runnerApiBaseUrl,
      eventLogger,
      source
    });
  } catch (error) {
    eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
      transport,
      source,
      submissionId,
      gradingAttempt,
      correlationId,
      outcome: 'rejected',
      reason: 'producer_create_failed',
      errorType: error?.name ?? 'TypeError'
    });
    return false;
  }

  return producer.enqueue(message);
};
