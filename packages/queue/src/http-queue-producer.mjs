import { parseSubmissionQueueMessage } from './message-contract.mjs';
import { createQueueProducerPort } from './producer-port.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from './queue-event-logger.mjs';

const normalizeBaseUrl = (baseUrl) => baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

const getMessageEventDetails = (message, source) => ({
  transport: 'http',
  source,
  submissionId: message?.submissionId,
  gradingAttempt: message?.gradingAttempt,
  correlationId: message?.correlationId,
  schemaVersion: message?.schemaVersion
});

export const createHttpQueueProducer = ({
  baseUrl,
  fetchImpl = globalThis.fetch,
  eventLogger = createQueueEventLogger({ service: 'queue-producer' }),
  source = 'submission'
}) => {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new TypeError('queue HTTP baseUrl is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('queue HTTP fetch implementation is required');
  }

  const jobsUrl = `${normalizeBaseUrl(baseUrl)}/jobs`;

  return createQueueProducerPort({
    enqueue: async (message) => {
      const parsed = parseSubmissionQueueMessage(message);
      if (!parsed.success) {
        eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
          ...getMessageEventDetails(message, source),
          outcome: 'rejected',
          reason: parsed.error.code,
          field: parsed.error.field
        });
        return false;
      }

      try {
        const response = await fetchImpl(jobsUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed.data)
        });

        if (response.ok) {
          eventLogger.info(QUEUE_EVENTS.ENQUEUE_SUCCEEDED, {
            ...getMessageEventDetails(parsed.data, source),
            outcome: 'accepted',
            statusCode: response.status
          });
          return true;
        }

        eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
          ...getMessageEventDetails(parsed.data, source),
          outcome: 'rejected',
          reason: 'http_non_2xx',
          statusCode: response.status
        });
        return false;
      } catch (error) {
        eventLogger.error(QUEUE_EVENTS.ENQUEUE_FAILED, {
          ...getMessageEventDetails(parsed.data, source),
          outcome: 'failed',
          reason: 'network_error',
          errorType: error?.name ?? 'Error'
        });
        return false;
      }
    }
  });
};
