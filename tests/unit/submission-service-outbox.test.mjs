import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionAndEnqueue } from '../../apps/api/src/services/submission-service.mjs';

const validInput = {
  challengeSlug: 'js-bugfix-add',
  language: 'javascript',
  code: 'export const sum = () => 0;'
};

test('outbox有効時はatomic保存後のpublish失敗でも201で受理する', async () => {
  const calls = [];
  const result = await createSubmissionAndEnqueue(validInput, {
    outboxConfig: { enabled: true, batchSize: 10, pollIntervalMs: 1000 },
    createWithOutbox: async (body) => {
      calls.push(['createWithOutbox', body.challengeSlug]);
      return { id: 'submission-outbox', status: 'queued' };
    },
    dispatchOutbox: async ({ trigger, limit }) => {
      calls.push(['dispatchOutbox', trigger, limit]);
      throw new Error('simulated publish failure');
    },
    createLegacySubmission: async () => assert.fail('legacy create must not be called'),
    enqueueLegacy: async () => assert.fail('legacy enqueue must not be called')
  });

  assert.deepEqual(result, {
    data: { id: 'submission-outbox', status: 'queued' },
    statusCode: 201
  });
  assert.deepEqual(calls, [
    ['createWithOutbox', 'js-bugfix-add'],
    ['dispatchOutbox', 'submission', 10]
  ]);
});

test('outbox無効時は既存のenqueue失敗502を維持する', async () => {
  const result = await createSubmissionAndEnqueue(validInput, {
    outboxConfig: { enabled: false, batchSize: 25, pollIntervalMs: 1000 },
    createLegacySubmission: async () => ({
      id: 'submission-legacy',
      status: 'queued',
      gradingAttempt: 1,
      attemptIdempotencyKey: 'submission-legacy:attempt:1'
    }),
    enqueueLegacy: async () => false,
    createWithOutbox: async () => assert.fail('outbox create must not be called'),
    dispatchOutbox: async () => assert.fail('outbox dispatch must not be called')
  });

  assert.deepEqual(result, {
    error: 'Workerへのジョブ投入に失敗しました。',
    statusCode: 502
  });
});
