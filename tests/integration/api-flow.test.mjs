import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const waitForHealth = async (url, retries = 30) => {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // noop
    }
    await sleep(100);
  }
  throw new Error(`health check failed: ${url}`);
};

const startServer = (cmd, args, env) => spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'ignore' });

const fetchSubmissionResultUntilCompleted = async (submissionId, headers = {}, retries = 160) => {
  const terminalStatuses = new Set(['completed', 'failed', 'infra_failed']);
  let resultData;
  for (let i = 0; i < retries; i += 1) {
    const resultRes = await fetch(`http://localhost:18080/api/submissions/${submissionId}`, { headers });
    resultData = await resultRes.json();
    if (resultData.result && terminalStatuses.has(resultData.status)) return resultData;
    await sleep(100);
  }
  throw new Error(`submission completion timeout: ${submissionId} (${resultData?.status ?? 'unknown'})`);
};

const assertLearnerSafeBoundary = (resultData) => {
  assert.equal(resultData.result.internal, undefined);
  assert.equal(resultData.result.logs, undefined);
  assert.equal(resultData.attemptIdempotencyKey, undefined);
  assert.equal(resultData.processingClaimedAt, undefined);
  assert.equal(resultData.processingHeartbeatAt, undefined);
  assert.equal(resultData.processingLeaseExpiresAt, undefined);
  const serialized = JSON.stringify(resultData);
  assert.equal(serialized.includes('[hidden] hidden tests log is not exposed in MVP.'), false);
};

const enqueueSubmissionToWorker = async (workerBaseUrl, submission) => {
  const response = await fetch(`${workerBaseUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      submissionId: submission.id,
      gradingAttempt: submission.gradingAttempt,
      attemptIdempotencyKey: submission.attemptIdempotencyKey
    })
  });
  assert.equal(response.status, 202);
};

test('challenge 一覧/詳細, JavaScript・TypeScript submission 作成/結果取得', async (t) => {
  const worker = startServer('node', ['apps/worker/src/server.mjs'], { WORKER_PORT: '18081' });
  const api = startServer('node', ['apps/api/src/server.mjs'], {
    API_PORT: '18080',
    RUNNER_API_BASE_URL: 'http://localhost:18081',
    ADMIN_PASSWORD: 'secure-admin',
    LEARNER_PASSWORD: 'secure-learner'
  });

  t.after(() => {
    api.kill('SIGKILL');
    worker.kill('SIGKILL');
  });

  await waitForHealth('http://localhost:18081/health');
  await waitForHealth('http://localhost:18080/health');

  const listRes = await fetch('http://localhost:18080/api/challenges');
  const listData = await listRes.json();
  assert.ok(listData.challenges.length >= 7);

  const detailRes = await fetch('http://localhost:18080/api/challenges/js-bugfix-add');
  const detailData = await detailRes.json();
  assert.equal(detailData.challenge.metadata.slug, 'js-bugfix-add');

  const submissionRes = await fetch('http://localhost:18080/api/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export function sum(nums){ while (true) {} }'
    })
  });
  assert.equal(submissionRes.status, 201);
  const submission = await submissionRes.json();

  const guestResultData = await fetchSubmissionResultUntilCompleted(submission.id);
  assert.equal(guestResultData.status, 'completed');
  assert.ok(Array.isArray(guestResultData.result.visibleTests));
  assert.equal(typeof guestResultData.result.hiddenTests.passed, 'boolean');
  assertLearnerSafeBoundary(guestResultData);

  const learnerResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'learner:secure-learner'
  });
  assert.equal(learnerResultData.status, 'completed');
  assert.ok(Array.isArray(learnerResultData.result.visibleTests));
  assertLearnerSafeBoundary(learnerResultData);

  const adminResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'admin:secure-admin'
  });
  assert.equal(adminResultData.status, 'completed');
  assert.ok(Array.isArray(adminResultData.result.visibleTests));
  assert.ok(Array.isArray(adminResultData.result.logs));
  assert.ok(adminResultData.result.internal);
  assert.ok(Array.isArray(adminResultData.result.internal.hiddenTestResults));
  assert.ok(Array.isArray(adminResultData.result.internal.fullTestResults));
  assert.equal(adminResultData.attemptIdempotencyKey, undefined);
  assert.equal(adminResultData.processingLeaseExpiresAt, undefined);

  const typescriptSubmissionRes = await fetch('http://localhost:18080/api/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'ts-feature-access-policy',
      language: 'typescript',
      code: `export type Role = 'admin' | 'editor' | 'viewer';
export type AccessLevel = 'blocked' | 'full' | 'write' | 'read';
export interface UserAccess { roles: Role[]; suspended: boolean; }
export function getAccessLevel(user: UserAccess): AccessLevel {
  if (user.suspended) return 'blocked';
  if (user.roles.includes('admin')) return 'full';
  if (user.roles.includes('editor')) return 'write';
  return 'read';
}`
    })
  });
  assert.equal(typescriptSubmissionRes.status, 201);
  const typescriptSubmission = await typescriptSubmissionRes.json();
  const typescriptResult = await fetchSubmissionResultUntilCompleted(typescriptSubmission.id);
  assert.equal(typescriptResult.status, 'completed');
  assert.equal(typescriptResult.result.status, 'completed');
  assert.equal(typescriptResult.result.visibleTests.every((result) => result.passed), true);
  assert.equal(typescriptResult.result.hiddenTests.passed, true);
  assertLearnerSafeBoundary(typescriptResult);
});

test('timeout/runtime failure 経路でも learner-safe 境界を維持する', async (t) => {
  const worker = startServer('node', ['apps/worker/src/server.mjs'], { WORKER_PORT: '18081', RUNNER_ISOLATION_POC: '1' });
  const api = startServer('node', ['apps/api/src/server.mjs'], {
    API_PORT: '18080',
    RUNNER_API_BASE_URL: 'http://localhost:18081',
    ADMIN_PASSWORD: 'secure-admin',
    LEARNER_PASSWORD: 'secure-learner'
  });

  t.after(() => {
    api.kill('SIGKILL');
    worker.kill('SIGKILL');
  });

  await waitForHealth('http://localhost:18081/health');
  await waitForHealth('http://localhost:18080/health');

  const submissionRes = await fetch('http://localhost:18080/api/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export function sum(nums){ return nums.reduce((acc, n) => acc + n, 0); }'
    })
  });
  assert.equal(submissionRes.status, 201);
  const submission = await submissionRes.json();

  const guestResultData = await fetchSubmissionResultUntilCompleted(submission.id);
  assert.equal(guestResultData.status, 'completed');
  assert.equal(guestResultData.result.status, 'completed');
  assertLearnerSafeBoundary(guestResultData);

  const learnerResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'learner:secure-learner'
  });
  assert.equal(learnerResultData.status, 'completed');
  assert.equal(learnerResultData.result.status, 'completed');
  assertLearnerSafeBoundary(learnerResultData);

  const adminResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'admin:secure-admin'
  });
  assert.equal(adminResultData.status, 'completed');
  assert.equal(adminResultData.result.status, 'completed');
  assert.ok(Array.isArray(adminResultData.result.logs));
  assert.ok(adminResultData.result.internal);
  assert.ok(Array.isArray(adminResultData.result.internal.hiddenTestResults));
});

test('infrastructure failure は retry_pending -> queued 再投入後に infra_failed へ到達する', async (t) => {
  const worker = startServer('node', ['apps/worker/src/server.mjs'], {
    WORKER_PORT: '18082',
    WORKER_MAX_INFRA_RETRY_ATTEMPTS: '2'
  });
  const api = startServer('node', ['apps/api/src/server.mjs'], {
    API_PORT: '18080',
    RUNNER_API_BASE_URL: 'http://localhost:18082',
    ADMIN_PASSWORD: 'secure-admin',
    LEARNER_PASSWORD: 'secure-learner'
  });

  t.after(() => {
    api.kill('SIGKILL');
    worker.kill('SIGKILL');
  });

  await waitForHealth('http://localhost:18082/health');
  await waitForHealth('http://localhost:18080/health');

  const repo = await import('../../apps/api/src/repositories/submission-repository.mjs');
  const submission = await repo.createSubmission({
    challengeSlug: 'missing-challenge',
    language: 'javascript',
    code: 'module.exports=1;'
  });
  await enqueueSubmissionToWorker('http://localhost:18082', submission);

  const learnerResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'learner:secure-learner'
  });
  assert.equal(learnerResultData.status, 'failed');
  assert.equal(learnerResultData.result.status, 'failed');
  assertLearnerSafeBoundary(learnerResultData);

  const adminResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'admin:secure-admin'
  });
  assert.equal(adminResultData.status, 'infra_failed');
  assert.equal(adminResultData.result.status, 'infra_failed');
  assert.ok(Array.isArray(adminResultData.result.logs));
});

test('Worker起動時にlease付きでqueued submissionを回収して採点を再開する', async (t) => {
  const repo = await import('../../apps/api/src/repositories/submission-repository.mjs');
  const submission = await repo.createSubmission({
    challengeSlug: 'js-bugfix-add',
    language: 'javascript',
    code: 'export function sum(nums){ return nums.reduce((acc, n) => acc + n, 0); }'
  });

  const worker = startServer('node', ['apps/worker/src/server.mjs'], {
    WORKER_PORT: '18083',
    WORKER_HEARTBEAT_ENABLED: '1',
    WORKER_LEASE_DURATION_MS: '3000',
    WORKER_HEARTBEAT_INTERVAL_MS: '500'
  });
  t.after(() => worker.kill('SIGKILL'));

  await waitForHealth('http://localhost:18083/health');

  let recovered = submission;
  for (let i = 0; i < 80; i += 1) {
    recovered = await repo.getSubmission(submission.id);
    if (recovered.result && recovered.status === 'completed') break;
    await sleep(100);
  }

  assert.equal(recovered.status, 'completed');
  assert.ok(recovered.completionGuardAt);
  assert.ok(recovered.result);
  assert.equal(recovered.processingClaimedAt, null);
  assert.equal(recovered.processingHeartbeatAt, null);
  assert.equal(recovered.processingLeaseExpiresAt, null);
});

test('retry再投入失敗時にqueued attemptをinfra_failedへ終端化する', async (t) => {
  const worker = startServer('node', ['apps/worker/src/server.mjs'], {
    WORKER_PORT: '18084',
    WORKER_MAX_INFRA_RETRY_ATTEMPTS: '2',
    WORKER_RETRY_ENQUEUE_BASE_URL: 'http://localhost:65530'
  });
  const api = startServer('node', ['apps/api/src/server.mjs'], {
    API_PORT: '18080',
    RUNNER_API_BASE_URL: 'http://localhost:18084',
    ADMIN_PASSWORD: 'secure-admin',
    LEARNER_PASSWORD: 'secure-learner'
  });

  t.after(() => {
    api.kill('SIGKILL');
    worker.kill('SIGKILL');
  });

  await waitForHealth('http://localhost:18084/health');
  await waitForHealth('http://localhost:18080/health');

  const repo = await import('../../apps/api/src/repositories/submission-repository.mjs');
  const submission = await repo.createSubmission({
    challengeSlug: 'missing-challenge',
    language: 'javascript',
    code: 'module.exports=1;'
  });
  await enqueueSubmissionToWorker('http://localhost:18084', submission);

  const learnerResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'learner:secure-learner'
  });
  assert.equal(learnerResultData.status, 'failed');
  assert.equal(learnerResultData.result.status, 'failed');
  assertLearnerSafeBoundary(learnerResultData);

  const adminResultData = await fetchSubmissionResultUntilCompleted(submission.id, {
    'x-web-user': 'admin:secure-admin'
  });
  assert.equal(adminResultData.status, 'infra_failed');
  assert.equal(adminResultData.result.status, 'infra_failed');
  assert.deepEqual(adminResultData.result.logs, ['Retryジョブの再投入に失敗しました。']);
});
