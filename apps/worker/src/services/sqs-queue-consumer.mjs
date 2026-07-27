import { setTimeout as sleep } from 'node:timers/promises';
import { parseSubmissionQueueMessage } from '../../../../packages/queue/src/message-contract.mjs';
import { createNoopQueueEventLogger, QUEUE_EVENTS } from '../../../../packages/queue/src/queue-event-logger.mjs';

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const toDeliveryCount = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const assertIntegerInRange = (value, name, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
};

const parseSqsDelivery = (delivery) => {
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
    return { success: false, reason: 'invalid_envelope' };
  }

  const messageId = isNonEmptyString(delivery.MessageId) ? delivery.MessageId : undefined;
  const deliveryCount = toDeliveryCount(delivery.Attributes?.ApproximateReceiveCount);

  if (!messageId) {
    return { success: false, reason: 'missing_message_id', deliveryCount };
  }
  if (!isNonEmptyString(delivery.ReceiptHandle)) {
    return { success: false, reason: 'missing_receipt_handle', messageId, deliveryCount };
  }
  if (!isNonEmptyString(delivery.Body)) {
    return { success: false, reason: 'missing_body', messageId, deliveryCount };
  }

  let body;
  try {
    body = JSON.parse(delivery.Body);
  } catch {
    return { success: false, reason: 'invalid_json', messageId, deliveryCount };
  }

  const parsed = parseSubmissionQueueMessage(body);
  if (!parsed.success) {
    return {
      success: false,
      reason: parsed.error.code,
      field: parsed.error.field,
      messageId,
      deliveryCount,
      submissionId: body?.submissionId,
      gradingAttempt: body?.gradingAttempt,
      correlationId: body?.correlationId,
      schemaVersion: body?.schemaVersion
    };
  }

  return {
    success: true,
    messageId,
    receiptHandle: delivery.ReceiptHandle,
    deliveryCount,
    message: parsed.data
  };
};

const createVisibilityController = ({
  client,
  commandFactory,
  queueUrl,
  receiptHandle,
  visibilityTimeoutSeconds,
  visibilityHeartbeatSeconds,
  message,
  messageId,
  deliveryCount,
  eventLogger,
  setIntervalFn,
  clearIntervalFn
}) => {
  let stopped = false;
  let pending = null;

  const extend = async () => {
    if (stopped || pending) return false;

    pending = (async () => {
      try {
        await client.send(commandFactory({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: visibilityTimeoutSeconds
        }));
        eventLogger.info(QUEUE_EVENTS.VISIBILITY_EXTENDED, {
          transport: 'sqs',
          provider: 'aws',
          source: 'consumer',
          outcome: 'extended',
          messageId,
          deliveryCount,
          submissionId: message.submissionId,
          gradingAttempt: message.gradingAttempt,
          correlationId: message.correlationId,
          schemaVersion: message.schemaVersion
        });
        return true;
      } catch (error) {
        eventLogger.warn(QUEUE_EVENTS.VISIBILITY_EXTENSION_FAILED, {
          transport: 'sqs',
          provider: 'aws',
          source: 'consumer',
          outcome: 'failed',
          reason: 'change_visibility_failed',
          messageId,
          deliveryCount,
          submissionId: message.submissionId,
          gradingAttempt: message.gradingAttempt,
          correlationId: message.correlationId,
          schemaVersion: message.schemaVersion,
          errorType: error?.name ?? 'SqsChangeMessageVisibilityError'
        });
        return false;
      } finally {
        pending = null;
      }
    })();

    return pending;
  };

  const timer = setIntervalFn(() => {
    void extend();
  }, visibilityHeartbeatSeconds * 1_000);
  timer?.unref?.();

  return {
    extend,
    stop: async () => {
      stopped = true;
      clearIntervalFn(timer);
      if (pending) await pending;
    }
  };
};

export const createSqsQueueConsumer = ({
  client,
  queueUrl,
  waitTimeSeconds,
  visibilityTimeoutSeconds,
  visibilityHeartbeatSeconds,
  pollErrorDelayMs = 1_000,
  processMessage,
  receiveCommandFactory,
  deleteCommandFactory,
  changeVisibilityCommandFactory,
  eventLogger = createNoopQueueEventLogger(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  sleepFn = sleep
}) => {
  if (!client || typeof client.send !== 'function') {
    throw new TypeError('SQS consumer client.send is required.');
  }
  if (!isNonEmptyString(queueUrl)) {
    throw new TypeError('SQS consumer queueUrl is required.');
  }
  assertIntegerInRange(waitTimeSeconds, 'SQS consumer waitTimeSeconds', 1, 20);
  assertIntegerInRange(visibilityTimeoutSeconds, 'SQS consumer visibilityTimeoutSeconds', 1, 43_200);
  assertIntegerInRange(visibilityHeartbeatSeconds, 'SQS consumer visibilityHeartbeatSeconds', 1, 43_200);
  if (visibilityHeartbeatSeconds * 3 > visibilityTimeoutSeconds) {
    throw new RangeError('SQS consumer visibilityHeartbeatSeconds must be at most one third of visibilityTimeoutSeconds.');
  }
  if (!Number.isSafeInteger(pollErrorDelayMs) || pollErrorDelayMs <= 0) {
    throw new RangeError('SQS consumer pollErrorDelayMs must be a positive safe integer.');
  }
  if (typeof processMessage !== 'function') {
    throw new TypeError('SQS consumer processMessage is required.');
  }
  if (typeof receiveCommandFactory !== 'function'
    || typeof deleteCommandFactory !== 'function'
    || typeof changeVisibilityCommandFactory !== 'function') {
    throw new TypeError('SQS consumer command factories are required.');
  }
  if (typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function' || typeof sleepFn !== 'function') {
    throw new TypeError('SQS consumer timer functions are required.');
  }

  let running = false;
  let loopPromise = null;

  const processDelivery = async (delivery) => {
    const parsed = parseSqsDelivery(delivery);
    if (!parsed.success) {
      eventLogger.warn(QUEUE_EVENTS.DELIVERY_REJECTED, {
        transport: 'sqs',
        provider: 'aws',
        source: 'consumer',
        outcome: 'rejected',
        reason: parsed.reason,
        field: parsed.field,
        messageId: parsed.messageId,
        deliveryCount: parsed.deliveryCount,
        submissionId: parsed.submissionId,
        gradingAttempt: parsed.gradingAttempt,
        correlationId: parsed.correlationId,
        schemaVersion: parsed.schemaVersion
      });
      return { accepted: false, deleted: false, reason: parsed.reason };
    }

    const { message } = parsed;
    eventLogger.info(QUEUE_EVENTS.DELIVERY_ACCEPTED, {
      transport: 'sqs',
      provider: 'aws',
      source: 'consumer',
      outcome: 'accepted',
      messageId: parsed.messageId,
      deliveryCount: parsed.deliveryCount,
      submissionId: message.submissionId,
      gradingAttempt: message.gradingAttempt,
      correlationId: message.correlationId,
      schemaVersion: message.schemaVersion
    });

    const visibility = createVisibilityController({
      client,
      commandFactory: changeVisibilityCommandFactory,
      queueUrl,
      receiptHandle: parsed.receiptHandle,
      visibilityTimeoutSeconds,
      visibilityHeartbeatSeconds,
      message,
      messageId: parsed.messageId,
      deliveryCount: parsed.deliveryCount,
      eventLogger,
      setIntervalFn,
      clearIntervalFn
    });

    let processingResult;
    try {
      processingResult = await processMessage(message);
    } catch (error) {
      await visibility.stop();
      eventLogger.error(QUEUE_EVENTS.CONSUMER_PROCESSING_FAILED, {
        transport: 'sqs',
        provider: 'aws',
        source: 'consumer',
        outcome: 'failed',
        reason: 'processing_failed',
        messageId: parsed.messageId,
        deliveryCount: parsed.deliveryCount,
        submissionId: message.submissionId,
        gradingAttempt: message.gradingAttempt,
        correlationId: message.correlationId,
        schemaVersion: message.schemaVersion,
        errorType: error?.name ?? 'QueueConsumerProcessingError'
      });
      return { accepted: true, deleted: false, reason: 'processing_failed' };
    }

    await visibility.stop();

    if (processingResult?.acknowledge === false) {
      const reason = processingResult.reason ?? 'durable_state_not_confirmed';
      eventLogger.warn(QUEUE_EVENTS.ACK_DEFERRED, {
        transport: 'sqs',
        provider: 'aws',
        source: 'consumer',
        outcome: 'deferred',
        reason,
        messageId: parsed.messageId,
        deliveryCount: parsed.deliveryCount,
        submissionId: message.submissionId,
        gradingAttempt: message.gradingAttempt,
        correlationId: message.correlationId,
        schemaVersion: message.schemaVersion
      });
      return { accepted: true, deleted: false, reason };
    }

    try {
      await client.send(deleteCommandFactory({
        QueueUrl: queueUrl,
        ReceiptHandle: parsed.receiptHandle
      }));
      eventLogger.info(QUEUE_EVENTS.ACK_SUCCEEDED, {
        transport: 'sqs',
        provider: 'aws',
        source: 'consumer',
        outcome: 'deleted',
        messageId: parsed.messageId,
        deliveryCount: parsed.deliveryCount,
        submissionId: message.submissionId,
        gradingAttempt: message.gradingAttempt,
        correlationId: message.correlationId,
        schemaVersion: message.schemaVersion
      });
      return { accepted: true, deleted: true };
    } catch (error) {
      eventLogger.warn(QUEUE_EVENTS.ACK_FAILED, {
        transport: 'sqs',
        provider: 'aws',
        source: 'consumer',
        outcome: 'failed',
        reason: 'delete_message_failed',
        messageId: parsed.messageId,
        deliveryCount: parsed.deliveryCount,
        submissionId: message.submissionId,
        gradingAttempt: message.gradingAttempt,
        correlationId: message.correlationId,
        schemaVersion: message.schemaVersion,
        errorType: error?.name ?? 'SqsDeleteMessageError'
      });
      return { accepted: true, deleted: false, reason: 'delete_message_failed' };
    }
  };

  const pollOnce = async () => {
    let response;
    try {
      response = await client.send(receiveCommandFactory({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: waitTimeSeconds,
        VisibilityTimeout: visibilityTimeoutSeconds,
        AttributeNames: ['ApproximateReceiveCount']
      }));
    } catch (error) {
      eventLogger.error(QUEUE_EVENTS.CONSUMER_POLL_FAILED, {
        transport: 'sqs',
        provider: 'aws',
        source: 'consumer',
        outcome: 'failed',
        reason: 'receive_message_failed',
        errorType: error?.name ?? 'SqsReceiveMessageError'
      });
      return { received: 0, deleted: 0, failed: 1, pollFailed: true };
    }

    const deliveries = Array.isArray(response?.Messages) ? response.Messages : [];
    const summary = { received: deliveries.length, deleted: 0, failed: 0, pollFailed: false };
    for (const delivery of deliveries) {
      const result = await processDelivery(delivery);
      if (result.deleted) summary.deleted += 1;
      else if (result.accepted || result.reason) summary.failed += 1;
    }
    return summary;
  };

  const start = () => {
    if (running) return false;
    running = true;
    loopPromise = (async () => {
      while (running) {
        const result = await pollOnce();
        if (running && result.pollFailed) {
          await sleepFn(pollErrorDelayMs);
        }
      }
    })();
    return true;
  };

  const stop = async () => {
    if (!running && !loopPromise) return false;
    running = false;
    if (loopPromise) await loopPromise;
    loopPromise = null;
    return true;
  };

  return Object.freeze({
    pollOnce,
    processDelivery,
    start,
    stop,
    isRunning: () => running
  });
};
