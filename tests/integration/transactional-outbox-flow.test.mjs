import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const startServer = (args, env) => spawn('node', args, {
  env: { ...process.env, ...env },
  stdio: 'ignore'
});

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

const waitForTerminal = async (apiBaseUrl, submissionId, retries = 80) => {
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

const readOutboxRow = (submissionId) => {
  const database = new DatabaseSync(path.resolve(process.cwd(), '.data/app.db'));
  const row = database.prepare(`
    SELECT *
    FROM queue_outbox
    WHERE submission_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(submissionId);
  database.close();
  return row;
};

test('outbox有効時はatomic保存したmessageをdispatcher経由でWorkerへpublishする', async (t) => {
  const workerBaseUrl = 'http://localhost:18181';
  const apiBaseUrl = 'http://localhost:18180';
  const worker = startServer(['apps/worker/src/server.mjs'], {
    WORKER_PORT: '18181'
  });
  const api = startServer(['apps/api/src/server.mjs'], {
    API_PORT: '18180',
    RUNNER_API_BASE_URL: workerBaseUrl,
    API_QUEUE_OUTBOX_ENABLED: '1',
    API_QUEUE_OUTBOX_POLL_INTERVAL_MS: '100',
    API_QUEUE_OUTBOX_BATCH_SIZE: '10',
    ADMIN_PASSWORD: 'secure-admin',
    LEARNER_PASSWORD: 'secure-learner'
  });

  t.after(() => {
    api.kill('SIGKILL');
    worker.kill('SIGKILL');
  });

  await waitForHealth(`${workerBaseUrl}/health`);
  await waitForHealth(`${apiBaseUrl}/health`);

  const response = await fetch(`${apiBaseUrl}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export function sum(values){ return values.reduce((a, b) => a + b, 0); }'
    })
  });

  assert.equal(response.status, 201);
  const submission = await response.json();
  const result = await waitForTerminal(apiBaseUrl, submission.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.outbox, undefined);

  const outbox = readOutboxRow(submission.id);
  assert.ok(outbox);
  assert.equal(outbox.status, 'published');
  assert.ok(outbox.publish_attempts >= 1);
  assert.ok(outbox.published_at);
  const message = JSON.parse(outbox.message_json);
  assert.equal(message.submissionId, submission.id);
  assert.equal(message.gradingAttempt, 1);
  assert.equal(JSON.stringify(message).includes('export function sum'), false);
  assert.equal(JSON.stringify(message).includes('hiddenTests'), false);
});

test('Worker不在でもoutbox有効時は201で受理してpendingを保持する', async (t) => {
  const apiBaseUrl = 'http://localhost:18182';
  const api = startServer(['apps/api/src/server.mjs'], {
    API_PORT: '18182',
    RUNNER_API_BASE_URL: 'http://localhost:19999',
    API_QUEUE_OUTBOX_ENABLED: '1',
    API_QUEUE_OUTBOX_POLL_INTERVAL_MS: '60000',
    API_QUEUE_OUTBOX_BATCH_SIZE: '10',
    ADMIN_PASSWORD: 'secure-admin',
    LEARNER_PASSWORD: 'secure-learner'
  });

  t.after(() => api.kill('SIGKILL'));
  await waitForHealth(`${apiBaseUrl}/health`);

  const response = await fetch(`${apiBaseUrl}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export function sum(values){ return 0; }'
    })
  });

  assert.equal(response.status, 201);
  const submission = await response.json();
  assert.equal(submission.status, 'queued');
  assert.equal(submission.outbox, undefined);

  const outbox = readOutboxRow(submission.id);
  assert.ok(outbox);
  assert.equal(outbox.status, 'pending');
  assert.ok(outbox.publish_attempts >= 1);
  assert.equal(outbox.last_error_type, 'QueuePublishError');
  assert.equal(outbox.last_error_type.includes('ECONNREFUSED'), false);
});
