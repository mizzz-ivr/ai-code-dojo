import crypto from 'node:crypto';
import { parseSubmissionQueueMessage } from './message-contract.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from './queue-event-logger.mjs';

export const SQS_QUEUE_TYPES = Object.freeze({
  STANDARD: 'standard',
  FIFO: 'fifo'
});

const validQueueTypes = new Set(Object.values(SQS_QUEUE_TYPES));
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const assertQueueConfig = ({ queueUrl, queueType }) => {
  if (!isNonEmptyString(queueUrl)) {
    throw new TypeError('SQS queueUrl is required.');
  }
  if (!validQueueTypes.has(queueType)) {
    throw new TypeError('SQS queueType must be standard or fifo.');
  }
};

export const buildSqsSendMessageInput = ({
  queueUrl,
  queueType = SQS_QUEUE_TYPES.STANDARD,
  message
}) => {
  assertQueueConfig({ queueUrl, queueType });

  const parsed = parseSubmissionQueueMessage(message);
  if (!parsed.success) {
    throw new TypeError(`invalid submission queue message: ${parsed.error.code}`);
  }

  const input = {
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(parsed.data)
  };

  if (queueType === SQS_QUEUE_TYPES.FIFO) {
    input.MessageGroupId = sha256(`submission-group:${parsed.data.submissionId}`);
    input.MessageDeduplicationId = sha256([
      'submission-attempt',
      parsed.data.submissionId,
      parsed.data.gradingAttempt,
      parsed.data.attemptIdempotencyKey
    ].join(':'));
  }

  return input;
};

export const createSqsQueueProducer = ({
  client,
  commandFactory,
  queueUrl,
  queueType = SQS_QUEUE_TYPES.STANDARD,
  source = 'outbox',
  eventLogger = createQueueEventLogger({ service: 'api' })
}) => {
  assertQueueConfig({ queueUrl, queueType });
  if (!client || typeof client.send !== 'function') {
    throw new TypeError('SQS client.send is required.');
  }
  if (typeof commandFactory !== 'function') {
    throw new TypeError('SQS commandFactory is required.');
  }

  return {
    enqueue: async (message) => {
      const parsed = parseSubmissionQueueMessage(message);
      if (!parsed.success) {
        eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
          transport: 'sqs',
          provider: 'aws',
          queueType,
          source,
          submissionId: message?.submissionId,
          gradingAttempt: message?.gradingAttempt,
          outcome: 'rejected',
          reason: parsed.error.code,
          errorType: 'TypeError'
        });
        return false;
      }

      let command;
      try {
        const input = buildSqsSendMessageInput({
          queueUrl,
          queueType,
          message: parsed.data
        });
        command = commandFactory(input);
      } catch (error) {
        eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
          transport: 'sqs',
          provider: 'aws',
          queueType,
          source,
          submissionId: parsed.data.submissionId,
          gradingAttempt: parsed.data.gradingAttempt,
          schemaVersion: parsed.data.schemaVersion,
          outcome: 'rejected',
          reason: 'command_build_failed',
          errorType: error?.name ?? 'TypeError'
        });
        return false;
      }

      try {
        const response = await client.send(command);
        if (!isNonEmptyString(response?.MessageId)) {
          eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
            transport: 'sqs',
            provider: 'aws',
            queueType,
            source,
            submissionId: parsed.data.submissionId,
            gradingAttempt: parsed.data.gradingAttempt,
            schemaVersion: parsed.data.schemaVersion,
            outcome: 'rejected',
            reason: 'missing_message_id',
            errorType: 'SqsSendMessageResponseError'
          });
          return false;
        }

        eventLogger.info(QUEUE_EVENTS.ENQUEUE_SUCCEEDED, {
          transport: 'sqs',
          provider: 'aws',
          queueType,
          source,
          submissionId: parsed.data.submissionId,
          gradingAttempt: parsed.data.gradingAttempt,
          correlationId: parsed.data.correlationId,
          schemaVersion: parsed.data.schemaVersion,
          outcome: 'accepted'
        });
        return true;
      } catch (error) {
        eventLogger.warn(QUEUE_EVENTS.ENQUEUE_FAILED, {
          transport: 'sqs',
          provider: 'aws',
          queueType,
          source,
          submissionId: parsed.data.submissionId,
          gradingAttempt: parsed.data.gradingAttempt,
          correlationId: parsed.data.correlationId,
          schemaVersion: parsed.data.schemaVersion,
          outcome: 'rejected',
          reason: 'send_failed',
          errorType: error?.name ?? 'SqsSendMessageError'
        });
        return false;
      }
    }
  };
};
