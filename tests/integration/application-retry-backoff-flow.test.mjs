import test from 'node:test';
import assert from 'node:assert/strict';
import { getApplicationRetryBackoffConfig } from '../../apps/worker/src/config/application-retry-backoff-config.mjs';
import { createApplicationRetryBackoff } from '../../apps/worker/src/services/application-retry-backoff.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from '../../packages/queue/src/queue-event-logger.mjs';

const createEventRecorder = () => {
  const events = [];
  const logger = createQueueEventLogger({
    service: 'worker',
    now: () => '2026-07-25T00:00:00.000Z',
    writeLine: (_level, line) => events.push(JSON.parse(line))
  });
  return { events, logger };
};

test('application retryはdelay event、待機、enqueueの順で実行する', async () => {
  const actions = [];
  const { events, logger } = createEventRecorder();
  const config = getApplicationRetryBackoffConfig({
    WORKER_APPLICATION_RETRY_BACKOFF_ENABLED: '1',
    WORKER_APPLICATION_RETRY_BASE_DELAY_MS: '100',
    WORKER_APPLICATION_RETRY_MAX_DELAY_MS: '800'
  });
  const backoff = createApplicationRetryBackoff({
    config,
    random: () => 0.25,
    sleep: async (delayMs) => actions.push({ action: 'sleep', delayMs })
  });

  const retryDelay = backoff.calculate({ nextAttempt: 4 });
  logger.info(QUEUE_EVENTS.RETRY_DELAY_SCHEDULED, {
    submissionId: 'submission-backoff',
    previousAttempt: 3,
    nextAttempt: 4,
    retryOrdinal: retryDelay.retryOrdinal,
    delayMs: retryDelay.delayMs,
    capDelayMs: retryDelay.capDelayMs,
    backoffEnabled: retryDelay.backoffEnabled,
    outcome: 'scheduled',
    attemptIdempotencyKey: 'must-not-be-logged',
    code: 'must-not-be-logged',
    hiddenTests: ['must-not-be-logged']
  });
  actions.push({ action: 'event' });

  await backoff.wait(retryDelay.delayMs);
  actions.push({ action: 'enqueue' });

  assert.deepEqual(retryDelay, {
    backoffEnabled: true,
    retryOrdinal: 2,
    delayMs: 100,
    capDelayMs: 400
  });
  assert.deepEqual(actions, [
    { action: 'event' },
    { action: 'sleep', delayMs: 100 },
    { action: 'enqueue' }
  ]);
  assert.deepEqual(events, [{
    timestamp: '2026-07-25T00:00:00.000Z',
    level: 'info',
    service: 'worker',
    event: 'queue.retry.delay_scheduled',
    submissionId: 'submission-backoff',
    previousAttempt: 3,
    nextAttempt: 4,
    retryOrdinal: 2,
    delayMs: 100,
    capDelayMs: 400,
    backoffEnabled: true,
    outcome: 'scheduled'
  }]);

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('attemptIdempotencyKey'), false);
  assert.equal(serialized.includes('must-not-be-logged'), false);
  assert.equal(serialized.includes('hiddenTests'), false);
});

test('delay待機失敗時は一般化eventを記録して即時enqueueへフォールバックできる', async () => {
  const actions = [];
  const { events, logger } = createEventRecorder();
  const backoff = createApplicationRetryBackoff({
    config: { enabled: true, baseDelayMs: 50, maxDelayMs: 500 },
    random: () => 0.5,
    sleep: async () => {
      actions.push({ action: 'sleep_failed' });
      throw new Error('sensitive internal timer failure');
    }
  });

  const retryDelay = backoff.calculate({ nextAttempt: 2 });
  try {
    await backoff.wait(retryDelay.delayMs);
  } catch (error) {
    logger.warn(QUEUE_EVENTS.RETRY_DELAY_FAILED, {
      submissionId: 'submission-fallback',
      gradingAttempt: 2,
      retryOrdinal: retryDelay.retryOrdinal,
      delayMs: retryDelay.delayMs,
      backoffEnabled: retryDelay.backoffEnabled,
      outcome: 'fallback_immediate',
      reason: 'delay_wait_failed',
      errorType: error.name,
      message: error.message
    });
  }
  actions.push({ action: 'enqueue' });

  assert.deepEqual(actions, [
    { action: 'sleep_failed' },
    { action: 'enqueue' }
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    timestamp: '2026-07-25T00:00:00.000Z',
    level: 'warn',
    service: 'worker',
    event: 'queue.retry.delay_failed',
    submissionId: 'submission-fallback',
    gradingAttempt: 2,
    retryOrdinal: 0,
    delayMs: 25,
    backoffEnabled: true,
    outcome: 'fallback_immediate',
    reason: 'delay_wait_failed',
    errorType: 'Error'
  });
  assert.equal(JSON.stringify(events).includes('sensitive internal timer failure'), false);
});
