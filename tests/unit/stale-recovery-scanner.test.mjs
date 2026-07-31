import test from 'node:test';
import assert from 'node:assert/strict';
import { runStaleRecoveryScan } from '../../apps/worker/src/services/stale-recovery-scanner.mjs';

const silentLogger = {
  log: () => {},
  error: () => {}
};

test('stale recovery scannerは注入したruntime enqueueで回収成功・上限到達・再投入失敗を集計する', async () => {
  const candidates = [
    { id: 'requeue', gradingAttempt: 1, attemptIdempotencyKey: 'requeue:attempt:1', processingLeaseExpiresAt: '2026-07-23T00:00:00.000Z' },
    { id: 'terminal', gradingAttempt: 2, attemptIdempotencyKey: 'terminal:attempt:2', processingLeaseExpiresAt: '2026-07-23T00:00:00.000Z' },
    { id: 'enqueue-fail', gradingAttempt: 1, attemptIdempotencyKey: 'enqueue-fail:attempt:1', processingLeaseExpiresAt: '2026-07-23T00:00:00.000Z' },
    { id: 'no-op', gradingAttempt: 1, attemptIdempotencyKey: 'no-op:attempt:1', processingLeaseExpiresAt: '2026-07-23T00:00:00.000Z' }
  ];
  const finalized = [];
  const enqueueCalls = [];

  const summary = await runStaleRecoveryScan({
    config: { enabled: true, intervalMs: 1000, batchSize: 10, concurrency: 2 },
    maxInfraRetryAttempts: 2,
    retryEnqueueBaseUrl: 'http://worker.example',
    enqueueAttempt: async (params) => {
      enqueueCalls.push(params);
      return params.submissionId !== 'enqueue-fail';
    },
    timestamp: '2026-07-23T00:00:01.000Z',
    logger: silentLogger,
    dependencies: {
      listStaleRunningSubmissions: async () => candidates,
      recoverStaleRunningSubmission: async ({ id }) => {
        if (id === 'no-op') return null;
        if (id === 'terminal') {
          return {
            action: 'infra_failed',
            previousAttempt: 2,
            submission: { id, status: 'infra_failed', gradingAttempt: 2, attemptIdempotencyKey: 'terminal:attempt:2' }
          };
        }
        return {
          action: 'requeued',
          previousAttempt: 1,
          submission: { id, status: 'queued', gradingAttempt: 2, attemptIdempotencyKey: `${id}:attempt:2` }
        };
      },
      enqueueSubmissionAttempt: async () => {
        throw new Error('default enqueue must not be used when runtime enqueue is injected');
      },
      finalizeQueuedAttemptAsInfraFailed: async (id) => {
        finalized.push(id);
        return { id, status: 'infra_failed' };
      }
    }
  });

  assert.deepEqual(summary, {
    scanned: 4,
    requeued: 1,
    terminalized: 1,
    enqueueFailedFinalized: 1,
    noOp: 1,
    errors: 0
  });
  assert.deepEqual(enqueueCalls.map(({ submissionId, source }) => ({ submissionId, source })), [
    { submissionId: 'requeue', source: 'stale_recovery' },
    { submissionId: 'enqueue-fail', source: 'stale_recovery' }
  ]);
  assert.deepEqual(finalized, ['enqueue-fail']);
});
