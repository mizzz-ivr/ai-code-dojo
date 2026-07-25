import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const workerBaseUrl = 'http://localhost:18085';

const waitForHealth = async (url, retries = 30) => {
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

const createEventCollector = (streams) => {
  const events = [];
  let buffer = '';
  const collect = (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const payload = JSON.parse(line);
        if (typeof payload.event === 'string') events.push(payload);
      } catch {
        // queue event以外の通常ログは対象外
      }
    }
  };
  for (const stream of streams) stream?.on('data', collect);
  return events;
};

const waitForEvent = async (events, eventName, reason, retries = 30) => {
  for (let i = 0; i < retries; i += 1) {
    const matched = events.find((event) => event.event === eventName && (reason === undefined || event.reason === reason));
    if (matched) return matched;
    await sleep(50);
  }
  throw new Error(`queue event not observed: ${eventName}/${reason ?? '*'}`);
};

test('Worker /jobsは共通queue message contractと構造化イベント契約を適用する', async (t) => {
  const worker = spawn('node', ['apps/worker/src/server.mjs'], {
    env: { ...process.env, WORKER_PORT: '18085' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const events = createEventCollector([worker.stdout, worker.stderr]);
  t.after(() => worker.kill('SIGKILL'));

  await waitForHealth(`${workerBaseUrl}/health`);

  const missingVersion = await fetch(`${workerBaseUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      submissionId: 'submission-1',
      gradingAttempt: 1,
      attemptIdempotencyKey: 'submission-1:attempt:1'
    })
  });
  assert.equal(missingVersion.status, 400);
  assert.equal((await missingVersion.json()).code, 'unsupported_schema_version');

  const forbiddenPayload = await fetch(`${workerBaseUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      submissionId: 'submission-1',
      gradingAttempt: 1,
      attemptIdempotencyKey: 'submission-1:attempt:1',
      code: 'must not be transported'
    })
  });
  assert.equal(forbiddenPayload.status, 400);
  assert.equal((await forbiddenPayload.json()).code, 'unknown_field');

  const invalidJson = await fetch(`${workerBaseUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, 'invalid_json');

  const validMessage = await fetch(`${workerBaseUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      submissionId: 'missing-submission',
      gradingAttempt: 1,
      attemptIdempotencyKey: 'missing-submission:attempt:1'
    })
  });
  assert.equal(validMessage.status, 202);
  assert.deepEqual(await validMessage.json(), {
    accepted: true,
    submissionId: 'missing-submission',
    gradingAttempt: 1
  });

  await waitForEvent(events, 'queue.delivery.rejected', 'unsupported_schema_version');
  await waitForEvent(events, 'queue.delivery.rejected', 'unknown_field');
  await waitForEvent(events, 'queue.delivery.rejected', 'invalid_json');
  await waitForEvent(events, 'queue.delivery.accepted');
  await waitForEvent(events, 'queue.claim.noop', 'submission_not_found');

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('must not be transported'), false);
  assert.equal(serialized.includes('submission-1:attempt:1'), false);
  assert.equal(serialized.includes('missing-submission:attempt:1'), false);
  assert.equal(serialized.includes('attemptIdempotencyKey'), false);
});
