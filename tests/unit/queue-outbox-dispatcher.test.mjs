import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueEventLogger } from '../../packages/queue/src/queue-event-logger.mjs';
import {
  dispatchQueueOutboxBatch,
  startQueueOutboxDispatcher
} from '../../apps/api/src/services/queue-outbox-dispatcher.mjs';

const createCollectingLogger = () => {
  const events = [];
  const logger = createQueueEventLogger({
    service: 'api',
    now: () => '2026-07-25T00:00:00.000Z',
    writeLine: (_level, line) => events.push(JSON.parse(line))
  });
  return { logger, events };
};

const pendingRow = {
  id: 'outbox-1',
  submissionId: 'submission-1',
  gradingAttempt: 1,
  message: {
    schemaVersion: 1,
    submissionId: 'submission-1',
    gradingAttempt: 1,
    attemptIdempotencyKey: 'submission-1:attempt:1'
  },
  messageErrorType: null,
  status: 'pending'
};

test('dispatcherはpublish成功時だけoutboxをpublishedへ更新する', async () => {
  const { logger, events } = createCollectingLogger();
  const calls = [];

  const summary = await dispatchQueueOutboxBatch({
    limit: 10,
    trigger: 'test',
    eventLogger: logger,
    listPending: async ({ limit }) => {
      assert.equal(limit, 10);
      return [pendingRow];
    },
    enqueue: async (message) => {
      calls.push(['enqueue', message.submissionId, message.source]);
      return true;
    },
    markPublished: async (id) => {
      calls.push(['published', id]);
      return { id, status: 'published' };
    },
    recordFailure: async () => {
      assert.fail('recordFailure must not be called on success');
    }
  });

  assert.deepEqual(summary, { scanned: 1, published: 1, failed: 0 });
  assert.deepEqual(calls, [
    ['enqueue', 'submission-1', 'outbox'],
    ['published', 'outbox-1']
  ]);
  assert.ok(events.some((event) => event.event === 'queue.outbox.publish_succeeded'));
  assert.ok(events.some((event) => event.event === 'queue.outbox.dispatch_completed'));

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('attemptIdempotencyKey'), false);
  assert.equal(serialized.includes('submission-1:attempt:1'), false);
  assert.equal(serialized.includes('hiddenTests'), false);
});

test('dispatcherはpublish失敗時にpendingを維持して一般化error typeを記録する', async () => {
  const { logger, events } = createCollectingLogger();
  const failures = [];

  const summary = await dispatchQueueOutboxBatch({
    eventLogger: logger,
    listPending: async () => [pendingRow],
    enqueue: async () => false,
    markPublished: async () => {
      assert.fail('markPublished must not be called on failure');
    },
    recordFailure: async (id, errorType) => {
      failures.push([id, errorType]);
      return { id, status: 'pending', publishAttempts: 1 };
    }
  });

  assert.deepEqual(summary, { scanned: 1, published: 0, failed: 1 });
  assert.deepEqual(failures, [['outbox-1', 'QueuePublishError']]);
  const failureEvent = events.find((event) => event.event === 'queue.outbox.publish_failed');
  assert.equal(failureEvent.outcome, 'pending');
  assert.equal(failureEvent.reason, 'enqueue_failed');
  assert.equal(failureEvent.errorType, 'QueuePublishError');
});

test('dispatcher controllerは無効時に実行せず同時実行をskipする', async () => {
  let dispatchCalls = 0;
  const disabled = startQueueOutboxDispatcher({
    config: { enabled: false, pollIntervalMs: 1000, batchSize: 25 },
    dispatch: async () => {
      dispatchCalls += 1;
      return { scanned: 0, published: 0, failed: 0 };
    }
  });

  assert.deepEqual(await disabled.trigger('test'), {
    scanned: 0,
    published: 0,
    failed: 0,
    disabled: true
  });
  assert.equal(dispatchCalls, 0);

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const enabled = startQueueOutboxDispatcher({
    config: { enabled: true, pollIntervalMs: 60_000, batchSize: 25 },
    dispatch: async () => {
      dispatchCalls += 1;
      await pending;
      return { scanned: 1, published: 1, failed: 0 };
    },
    setIntervalFn: () => ({ unref: () => {} }),
    clearIntervalFn: () => {}
  });

  const skipped = await enabled.trigger('manual');
  assert.equal(skipped.skipped, true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  enabled.stop();
});
