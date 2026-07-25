import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const workerBaseUrl = 'http://localhost:18087';
const apiBaseUrl = 'http://localhost:18086';

const waitForHealth = async (url, retries = 40) => {
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

const waitForTerminal = async (submissionId, retries = 80) => {
  for (let i = 0; i < retries; i += 1) {
    const response = await fetch(`${apiBaseUrl}/api/submissions/${submissionId}`, {
      headers: { 'x-web-user': 'admin:secure-admin' }
    });
    const data = await response.json();
    if (data.result && ['completed', 'failed', 'infra_failed'].includes(data.status)) return data;
    await sleep(100);
  }
  throw new Error('submission did not reach terminal status');
};

const collectJsonLines = (stream, output) => {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('{')) continue;
      try {
        output.push(JSON.parse(line));
      } catch {
        // noop
      }
    }
  });
};

test('infrastructure failure retryはbackoff eventを記録して既存終端経路を維持する', async (t) => {
  const events = [];
  const worker = spawn('node', ['apps/worker/src/server.mjs'], {
    env: {
      ...process.env,
      WORKER_PORT: '18087',
      WORKER_MAX_INFRA_RETRY_ATTEMPTS: '2',
      WORKER_APPLICATION_RETRY_BACKOFF_ENABLED: '1',
      WORKER_APPLICATION_RETRY_BASE_DELAY_MS: '25',
      WORKER_APPLICATION_RETRY_MAX_DELAY_MS: '25'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  collectJsonLines(worker.stdout, events);
  collectJsonLines(worker.stderr, events);

  const api = spawn('node', ['apps/api/src/server.mjs'], {
    env: {
      ...process.env,
      API_PORT: '18086',
      RUNNER_API_BASE_URL: workerBaseUrl,
      ADMIN_PASSWORD: 'secure-admin',
      LEARNER_PASSWORD: 'secure-learner'
    },
    stdio: 'ignore'
  });

  t.after(() => {
    api.kill('SIGKILL');
    worker.kill('SIGKILL');
  });

  await waitForHealth(`${workerBaseUrl}/health`);
  await waitForHealth(`${apiBaseUrl}/health`);

  const submissionResponse = await fetch(`${apiBaseUrl}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'missing-challenge-backoff',
      language: 'javascript',
      code: 'module.exports=1;'
    })
  });
  assert.equal(submissionResponse.status, 201);
  const submission = await submissionResponse.json();

  const result = await waitForTerminal(submission.id);
  assert.equal(result.status, 'infra_failed');

  for (let i = 0; i < 20 && !events.some((event) => event.event === 'queue.retry.delay_scheduled'); i += 1) {
    await sleep(25);
  }

  const delayEvent = events.find((event) => event.event === 'queue.retry.delay_scheduled');
  assert.ok(delayEvent);
  assert.equal(delayEvent.submissionId, submission.id);
  assert.equal(delayEvent.previousAttempt, 1);
  assert.equal(delayEvent.nextAttempt, 2);
  assert.equal(delayEvent.retryOrdinal, 0);
  assert.equal(delayEvent.backoffEnabled, true);
  assert.equal(delayEvent.capDelayMs, 25);
  assert.ok(Number.isInteger(delayEvent.delayMs));
  assert.ok(delayEvent.delayMs >= 0 && delayEvent.delayMs < 25);

  const serialized = JSON.stringify(delayEvent);
  assert.equal(serialized.includes('attemptIdempotencyKey'), false);
  assert.equal(serialized.includes('module.exports'), false);
  assert.equal(serialized.includes('hiddenTests'), false);
});
