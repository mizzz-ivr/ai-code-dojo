import { buildSubmissionQueueMessage } from './message-contract.mjs';
import { createHttpQueueProducer } from './http-queue-producer.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from './queue-event-logger.mjs';

const getDefaultWorkerUrl = () => process.env.RUNNER_API_BASE_URL ?? 'http://localhost:8081';

let defaultQueueProducerRegistration = null;

export const setDefaultSubmissionQueueProducerFactory = (
  factory,
  { transport = 'http' } = {}
) => {
  if (factory !== null && typeof factory !== 'function') {
    throw new TypeError('default queue producer factory must be a function or null.');
  }
  if (typeof transport !== 'string' || transport.length === 0) {
    throw new TypeError('default queue producer transport is required.');
  }

  const previousRegistration = defaultQueueProducerRegistration;
  const registration = factory === null ? null : Object.freeze({ factory, transport });
  defaultQueueProducerRegistration = registration;
  let active = true;

  return () => {
    if (!active) return false;
    active = false;
    if (defaultQueueProducerRegistration !== registration) return false;
    defaultQueueProducerRegistration = previousRegistration;
    return true;
  };
};

const createDefaultQueueProducer = ({ runnerApiBaseUrl, eventLogger, source }) => {
  if (defaultQueueProducerRegistration) {
    const producer = defaultQueueProducerRegistration.factory({ eventLogger, source });
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
  const effectiveTransport = queueProducer
    ? transport
    : defaultQueueProducerRegistration?.transport ?? transport;

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
      transport: effectiveTransport,
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
      transport: effectiveTransport,
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
