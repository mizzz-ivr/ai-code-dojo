import { buildSubmissionQueueMessage } from './message-contract.mjs';
import { createHttpQueueProducer } from './http-queue-producer.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from './queue-event-logger.mjs';

const getDefaultWorkerUrl = () => process.env.RUNNER_API_BASE_URL ?? 'http://localhost:8081';

export const enqueueSubmissionAttempt = async ({
  submissionId,
  gradingAttempt,
  attemptIdempotencyKey,
  correlationId,
  runnerApiBaseUrl = getDefaultWorkerUrl(),
  queueProducer,
  eventLogger = createQueueEventLogger({ service: 'api' }),
  source = 'submission'
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
      transport: 'http',
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

  const producer = queueProducer ?? createHttpQueueProducer({
    baseUrl: runnerApiBaseUrl,
    eventLogger,
    source
  });
  return producer.enqueue(message);
};
