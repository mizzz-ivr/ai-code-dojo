import { enqueueSubmissionAttempt } from '../../../../packages/queue/src/submission-queue.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from '../../../../packages/queue/src/queue-event-logger.mjs';
import {
  listPendingQueueOutbox,
  markQueueOutboxPublished,
  recordQueueOutboxPublishFailure
} from '../repositories/queue-outbox-repository.mjs';

const defaultEventLogger = () => createQueueEventLogger({ service: 'api' });

export const dispatchQueueOutboxBatch = async ({
  limit = 25,
  trigger = 'manual',
  enqueue = enqueueSubmissionAttempt,
  listPending = listPendingQueueOutbox,
  markPublished = markQueueOutboxPublished,
  recordFailure = recordQueueOutboxPublishFailure,
  eventLogger = defaultEventLogger()
} = {}) => {
  let rows;
  try {
    rows = await listPending({ limit });
  } catch (error) {
    const errorType = error?.name ?? 'QueueOutboxReadError';
    eventLogger.error(QUEUE_EVENTS.OUTBOX_DISPATCH_FAILED, {
      source: 'outbox',
      trigger,
      outcome: 'failed',
      reason: 'pending_read_failed',
      errorType
    });
    return { scanned: 0, published: 0, failed: 1, errorType };
  }

  const summary = { scanned: rows.length, published: 0, failed: 0 };

  for (const row of rows) {
    const message = row.message;
    if (!message) {
      const errorType = row.messageErrorType ?? 'QueueOutboxMessageError';
      await recordFailure(row.id, errorType);
      summary.failed += 1;
      eventLogger.warn(QUEUE_EVENTS.OUTBOX_PUBLISH_FAILED, {
        transport: 'http',
        source: 'outbox',
        submissionId: row.submissionId,
        gradingAttempt: row.gradingAttempt,
        outcome: 'pending',
        reason: 'invalid_message',
        errorType
      });
      continue;
    }

    let enqueued = false;
    let errorType = 'QueuePublishError';
    try {
      enqueued = await enqueue({
        submissionId: message.submissionId,
        gradingAttempt: message.gradingAttempt,
        attemptIdempotencyKey: message.attemptIdempotencyKey,
        correlationId: message.correlationId,
        source: 'outbox',
        eventLogger
      });
    } catch (error) {
      errorType = error?.name ?? 'QueuePublishError';
    }

    if (!enqueued) {
      await recordFailure(row.id, errorType);
      summary.failed += 1;
      eventLogger.warn(QUEUE_EVENTS.OUTBOX_PUBLISH_FAILED, {
        transport: 'http',
        source: 'outbox',
        submissionId: row.submissionId,
        gradingAttempt: row.gradingAttempt,
        outcome: 'pending',
        reason: 'enqueue_failed',
        errorType
      });
      continue;
    }

    const published = await markPublished(row.id);
    summary.published += 1;
    eventLogger.info(QUEUE_EVENTS.OUTBOX_PUBLISH_SUCCEEDED, {
      transport: 'http',
      source: 'outbox',
      submissionId: row.submissionId,
      gradingAttempt: row.gradingAttempt,
      outcome: published ? 'published' : 'duplicate_publish',
      noOp: !published
    });
  }

  eventLogger.info(QUEUE_EVENTS.OUTBOX_DISPATCH_COMPLETED, {
    source: 'outbox',
    trigger,
    outcome: summary.failed === 0 ? 'completed' : 'partial_failure',
    scanned: summary.scanned,
    published: summary.published,
    failed: summary.failed
  });

  return summary;
};

export const startQueueOutboxDispatcher = ({
  config,
  dispatch = dispatchQueueOutboxBatch,
  eventLogger = defaultEventLogger(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) => {
  if (!config || typeof config !== 'object') {
    throw new TypeError('queue outbox config is required.');
  }

  let running = false;
  let timer = null;

  const trigger = async (source = 'manual') => {
    if (!config.enabled) {
      return { scanned: 0, published: 0, failed: 0, disabled: true };
    }
    if (running) {
      return { scanned: 0, published: 0, failed: 0, skipped: true };
    }

    running = true;
    try {
      return await dispatch({
        limit: config.batchSize,
        trigger: source,
        eventLogger
      });
    } finally {
      running = false;
    }
  };

  if (config.enabled) {
    void trigger('startup');
    timer = setIntervalFn(() => {
      void trigger('interval');
    }, config.pollIntervalMs);
    timer?.unref?.();
  }

  return {
    trigger,
    stop: () => {
      if (timer) clearIntervalFn(timer);
      timer = null;
    }
  };
};
