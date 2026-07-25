import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueEventLogger, QUEUE_EVENTS } from '../../packages/queue/src/queue-event-logger.mjs';

test('queue event loggerはallowlist fieldだけをJSON Linesへ出力する', () => {
  const lines = [];
  const logger = createQueueEventLogger({
    service: 'worker',
    now: () => '2026-07-24T00:00:00.000Z',
    writeLine: (level, line) => lines.push({ level, line })
  });

  const emitted = logger.info(QUEUE_EVENTS.DELIVERY_ACCEPTED, {
    transport: 'http',
    outcome: 'accepted',
    submissionId: 'submission-1',
    gradingAttempt: 2,
    correlationId: 'correlation-1',
    attemptIdempotencyKey: 'must-not-be-logged',
    code: 'must-not-be-logged',
    hiddenTests: ['must-not-be-logged'],
    secret: 'must-not-be-logged'
  });

  assert.equal(emitted, true);
  assert.equal(lines.length, 1);
  const payload = JSON.parse(lines[0].line);
  assert.deepEqual(payload, {
    timestamp: '2026-07-24T00:00:00.000Z',
    level: 'info',
    service: 'worker',
    event: 'queue.delivery.accepted',
    transport: 'http',
    outcome: 'accepted',
    submissionId: 'submission-1',
    gradingAttempt: 2,
    correlationId: 'correlation-1'
  });

  const serialized = lines[0].line;
  assert.equal(serialized.includes('must-not-be-logged'), false);
  assert.equal(serialized.includes('attemptIdempotencyKey'), false);
  assert.equal(serialized.includes('hiddenTests'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('queue event loggerは未定義eventを出力せず、writer失敗を業務処理へ伝播しない', () => {
  const lines = [];
  const logger = createQueueEventLogger({
    service: 'api',
    writeLine: (_level, line) => lines.push(line)
  });

  assert.equal(logger.info('queue.unknown.event', { outcome: 'ignored' }), false);
  assert.deepEqual(lines, []);

  const failingLogger = createQueueEventLogger({
    service: 'api',
    writeLine: () => {
      throw new Error('sink failed');
    }
  });
  assert.doesNotThrow(() => {
    assert.equal(failingLogger.error(QUEUE_EVENTS.ENQUEUE_FAILED, { reason: 'network_error' }), false);
  });
});
