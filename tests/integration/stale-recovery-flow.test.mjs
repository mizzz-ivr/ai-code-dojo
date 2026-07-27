import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const waitForHealth = async (url, retries = 50) => {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // noop
    }
    await sleep(100);
  }
  throw new Error(`health check failed: ${url}`);
};

const stopServer = async (process) => {
  if (!process || process.exitCode !== null) return;
  process.kill('SIGKILL');
  await once(process, 'exit');
};

const isDatabaseLocked = (error) => error?.code === 'ERR_SQLITE_ERROR'
  && String(error?.message).includes('database is locked');

const waitForCompletedAttempt = async (repo, submissionId, attempt, retries = 100) => {
  let current;
  for (let i = 0; i < retries; i += 1) {
    try {
      current = await repo.getSubmission(submissionId);
      if (current.status === 'completed' && current.gradingAttempt === attempt) return current;
    } catch (error) {
      if (!isDatabaseLocked(error)) throw error;
    }
    await sleep(100);
  }
  return current;
};

test('feature flag有効時だけstartup・periodic scannerが期限切れrunningを新attemptとして回収する', async () => {
  const repositoryRoot = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'dojo-stale-integration-'));
  const workerEntry = path.join(repositoryRoot, 'apps/worker/src/server.mjs');
  await symlink(path.join(repositoryRoot, 'problems'), path.join(dir, 'problems'), 'dir');
  process.chdir(dir);

  let disabledWorker;
  let enabledWorker;
  try {
    const repoUrl = pathToFileURL(path.join(repositoryRoot, 'apps/api/src/repositories/submission-repository.mjs'));
    const repo = await import(`${repoUrl.href}?stale-integration=${Date.now()}`);

    const startupSubmission = await repo.createSubmission({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export function sum(nums){ return nums.reduce((acc, n) => acc + n, 0); }'
    });
    await repo.claimSubmissionForProcessing({
      id: startupSubmission.id,
      gradingAttempt: startupSubmission.gradingAttempt,
      attemptIdempotencyKey: startupSubmission.attemptIdempotencyKey,
      leaseDurationMs: 1000,
      timestamp: new Date(Date.now() - 60_000).toISOString()
    });

    disabledWorker = spawn('node', [workerEntry], {
      cwd: dir,
      env: {
        ...process.env,
        WORKER_PORT: '18084',
        WORKER_HEARTBEAT_ENABLED: '1',
        WORKER_LEASE_DURATION_MS: '3000',
        WORKER_HEARTBEAT_INTERVAL_MS: '500'
      },
      stdio: 'ignore'
    });
    await waitForHealth('http://localhost:18084/health');
    await sleep(500);

    const stillRunning = await repo.getSubmission(startupSubmission.id);
    assert.equal(stillRunning.status, 'running');
    assert.equal(stillRunning.gradingAttempt, 1);
    await stopServer(disabledWorker);
    disabledWorker = null;

    enabledWorker = spawn('node', [workerEntry], {
      cwd: dir,
      env: {
        ...process.env,
        WORKER_PORT: '18085',
        WORKER_RETRY_ENQUEUE_BASE_URL: 'http://localhost:18085',
        WORKER_MAX_INFRA_RETRY_ATTEMPTS: '2',
        WORKER_HEARTBEAT_ENABLED: '1',
        WORKER_LEASE_DURATION_MS: '3000',
        WORKER_HEARTBEAT_INTERVAL_MS: '500',
        WORKER_STALE_RECOVERY_ENABLED: '1',
        WORKER_STALE_RECOVERY_INTERVAL_MS: '200',
        WORKER_STALE_RECOVERY_BATCH_SIZE: '5',
        WORKER_STALE_RECOVERY_CONCURRENCY: '1'
      },
      stdio: 'ignore'
    });
    await waitForHealth('http://localhost:18085/health');

    const startupRecovered = await waitForCompletedAttempt(repo, startupSubmission.id, 2);
    assert.equal(startupRecovered.status, 'completed');
    assert.equal(startupRecovered.gradingAttempt, 2);
    assert.ok(startupRecovered.completionGuardAt);
    assert.equal(startupRecovered.processingLeaseExpiresAt, null);

    const periodicSubmission = await repo.createSubmission({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export function sum(nums){ return nums.reduce((acc, n) => acc + n, 0); }'
    });
    await repo.claimSubmissionForProcessing({
      id: periodicSubmission.id,
      gradingAttempt: periodicSubmission.gradingAttempt,
      attemptIdempotencyKey: periodicSubmission.attemptIdempotencyKey,
      leaseDurationMs: 1000,
      timestamp: new Date(Date.now() - 60_000).toISOString()
    });

    const periodicRecovered = await waitForCompletedAttempt(repo, periodicSubmission.id, 2);
    assert.equal(periodicRecovered.status, 'completed');
    assert.equal(periodicRecovered.gradingAttempt, 2);
    assert.ok(periodicRecovered.completionGuardAt);
    assert.equal(periodicRecovered.processingLeaseExpiresAt, null);
  } finally {
    await stopServer(disabledWorker);
    await stopServer(enabledWorker);
    process.chdir(repositoryRoot);
    await rm(dir, { recursive: true, force: true });
  }
});
