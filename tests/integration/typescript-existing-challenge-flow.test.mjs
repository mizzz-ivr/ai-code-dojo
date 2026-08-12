import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const API_PORT = 18120;
const WORKER_PORT = 18121;

const waitForHealth = async (url, retries = 40) => {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server startup中は再試行する
    }
    await sleep(100);
  }
  throw new Error(`health check failed: ${url}`);
};

const startServer = (args, env) => spawn(process.execPath, args, {
  env: { ...process.env, ...env },
  stdio: 'ignore'
});

const waitForCompleted = async (submissionId, retries = 80) => {
  for (let i = 0; i < retries; i += 1) {
    const response = await fetch(`http://localhost:${API_PORT}/api/submissions/${submissionId}`);
    const data = await response.json();
    if (data.result && ['completed', 'failed'].includes(data.status)) return data;
    await sleep(100);
  }
  throw new Error('submission completion timeout');
};

test('既存ts-feature-user-displayをAPIからWorkerまで実採点できる', async (t) => {
  const worker = startServer(['apps/worker/src/server.mjs'], {
    WORKER_PORT: String(WORKER_PORT)
  });
  const api = startServer(['apps/api/src/server.mjs'], {
    API_PORT: String(API_PORT),
    RUNNER_API_BASE_URL: `http://localhost:${WORKER_PORT}`
  });

  t.after(() => {
    api.kill('SIGKILL');
    worker.kill('SIGKILL');
  });

  await waitForHealth(`http://localhost:${WORKER_PORT}/health`);
  await waitForHealth(`http://localhost:${API_PORT}/health`);

  const response = await fetch(`http://localhost:${API_PORT}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'ts-feature-user-display',
      language: 'typescript',
      code: `export interface User {
  firstName: string;
  lastName: string;
  nickName?: string;
}

export function formatDisplayName(user: User): string {
  return user.nickName ?? \`${'${user.firstName}'} ${'${user.lastName}'}\`;
}`
    })
  });

  assert.equal(response.status, 201);
  const submission = await response.json();
  const result = await waitForCompleted(submission.id);

  assert.equal(result.status, 'completed');
  assert.equal(result.result.status, 'completed');
  assert.equal(result.result.visibleTests.every((item) => item.passed), true);
  assert.equal(result.result.hiddenTests.passed, true);
  assert.equal(result.result.logs, undefined);
  assert.equal(result.result.internal, undefined);
});
