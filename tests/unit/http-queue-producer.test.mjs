import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpQueueProducer } from '../../packages/queue/src/http-queue-producer.mjs';
import { buildSubmissionQueueMessage } from '../../packages/queue/src/message-contract.mjs';
import { createQueueEventLogger } from '../../packages/queue/src/queue-event-logger.mjs';

const createCaptureLogger = () => {
  const events = [];
  return {
    events,
    logger: createQueueEventLogger({
      service: 'test',
      now: () => '2026-07-24T00:00:00.000Z',
      writeLine: (_level, line) => events.push(JSON.parse(line))
    })
  };
};

test('HTTP queue producerはversion付きmessageを/jobsへ送信して成功eventを出力する', async () => {
  const requests = [];
  const capture = createCaptureLogger();
  const producer = createHttpQueueProducer({
    baseUrl: 'http://worker.example/',
    eventLogger: capture.logger,
    source: 'api_submission',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 202 };
    }
  });

  const message = buildSubmissionQueueMessage({
    submissionId: 'submission-1',
    gradingAttempt: 2,
    attemptIdempotencyKey: 'submission-1:attempt:2'
  });
  const enqueued = await producer.enqueue(message);

  assert.equal(enqueued, true);
  assert.equal(requests[0].url, 'http://worker.example/jobs');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].init.body), message);
  assert.equal(capture.events.length, 1);
  assert.deepEqual(capture.events[0], {
    timestamp: '2026-07-24T00:00:00.000Z',
    level: 'info',
    service: 'test',
    event: 'queue.enqueue.succeeded',
    transport: 'http',
    source: 'api_submission',
    outcome: 'accepted',
    submissionId: 'submission-1',
    gradingAttempt: 2,
    schemaVersion: 1,
    statusCode: 202
  });
  assert.equal(JSON.stringify(capture.events).includes('submission-1:attempt:2'), false);
});

test('HTTP queue producerは非2xx・接続失敗・不正messageを失敗eventとして扱う', async () => {
  const message = buildSubmissionQueueMessage({
    submissionId: 'submission-1',
    gradingAttempt: 1,
    attemptIdempotencyKey: 'submission-1:attempt:1'
  });
  const capture = createCaptureLogger();

  const nonSuccessProducer = createHttpQueueProducer({
    baseUrl: 'http://worker.example',
    eventLogger: capture.logger,
    source: 'application_retry',
    fetchImpl: async () => ({ ok: false, status: 503 })
  });
  assert.equal(await nonSuccessProducer.enqueue(message), false);

  const failedProducer = createHttpQueueProducer({
    baseUrl: 'http://worker.example',
    eventLogger: capture.logger,
    source: 'stale_recovery',
    fetchImpl: async () => {
      throw new Error('sensitive network detail');
    }
  });
  assert.equal(await failedProducer.enqueue(message), false);

  let called = false;
  const invalidProducer = createHttpQueueProducer({
    baseUrl: 'http://worker.example',
    eventLogger: capture.logger,
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 202 };
    }
  });
  assert.equal(await invalidProducer.enqueue({ ...message, code: 'must not be sent' }), false);
  assert.equal(called, false);

  assert.deepEqual(capture.events.map((event) => [event.event, event.reason, event.statusCode]), [
    ['queue.enqueue.failed', 'http_non_2xx', 503],
    ['queue.enqueue.failed', 'network_error', undefined],
    ['queue.enqueue.failed', 'unknown_field', undefined]
  ]);
  const serialized = JSON.stringify(capture.events);
  assert.equal(serialized.includes('sensitive network detail'), false);
  assert.equal(serialized.includes('must not be sent'), false);
  assert.equal(serialized.includes('submission-1:attempt:1'), false);
});
