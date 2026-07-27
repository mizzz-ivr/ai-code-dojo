import { enqueueSubmissionAttempt } from '../../../../packages/queue/src/submission-queue.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from '../../../../packages/queue/src/queue-event-logger.mjs';
import {
  listPendingQueueOutbox,
  markQueueOutboxPublished,
  recordQueueOutboxPublishFailure
} from '../repositories/queue-outbox-repository.mjs';

const defaultEventLogger = () => createQueueEventLogger({ service: 'api' });

const logPublishFailure = ({
  eventLogger,
  row,
  transport,
  reason,
  errorType
}) => eventLogger.warn(QUEUE_EVENTS.OUTBOX_PUBLISH_FAILED, {
  transport,
  source: 'outbox',
  submissionId: row.submissionId,
  gradingAttempt: row.gradingAttempt,
  outcome: 'pending',
  reason,
  errorType
});

export const dispatchQueueOutboxBatch = async ({
  limit = 25,
  trigger = 'manual',
  transport = 'http',
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
      transport,
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
      try {
        await recordFailure(row.id, errorType);
        logPublishFailure({ eventLogger, row, transport, reason: 'invalid_message', errorType });
      } catch (error) {
        logPublishFailure({
          eventLogger,
          row,
          transport,
          reason: 'failure_state_update_failed',
          errorType: error?.name ?? 'QueueOutboxUpdateError'
        });
      }
      summary.failed += 1;
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
      try {
        await recordFailure(row.id, errorType);
        logPublishFailure({ eventLogger, row, transport, reason: 'enqueue_failed', errorType });
      } catch (error) {
        logPublishFailure({
          eventLogger,
          row,
          transport,
          reason: 'failure_state_update_failed',
          errorType: error?.name ?? 'QueueOutboxUpdateError'
        });
      }
      summary.failed += 1;
      continue;
    }

    try {
      const published = await markPublished(row.id);
      summary.published += 1;
      eventLogger.info(QUEUE_EVENTS.OUTBOX_PUBLISH_SUCCEEDED, {
        transport,
        source: 'outbox',
        submissionId: row.submissionId,
        gradingAttempt: row.gradingAttempt,
        outcome: published ? 'published' : 'duplicate_publish',
        noOp: !published
      });
    } catch (error) {
      summary.failed += 1;
      logPublishFailure({
        eventLogger,
        row,
        transport,
        reason: 'publish_state_update_failed',
        errorType: error?.name ?? 'QueueOutboxUpdateError'
      });
    }
  }

  eventLogger.info(QUEUE_EVENTS.OUTBOX_DISPATCH_COMPLETED, {
    transport,
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
  transport = 'http',
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
        transport,
        eventLogger
      });
    } catch (error) {
      const errorType = error?.name ?? 'QueueOutboxDispatchError';
      eventLogger.error(QUEUE_EVENTS.OUTBOX_DISPATCH_FAILED, {
        transport,
        source: 'outbox',
        trigger: source,
        outcome: 'failed',
        reason: 'unexpected_dispatch_error',
        errorType
      });
      return { scanned: 0, published: 0, failed: 1, errorType };
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
