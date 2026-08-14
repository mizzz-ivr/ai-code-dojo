import test from 'node:test';
import assert from 'node:assert/strict';
import { createPythonRunnerSignature, verifyPythonRunnerSignature } from '../../packages/runner-sdk/src/python-remote-auth.mjs';
import { createPythonRunnerJobRegistry, PythonRunnerBusyError, PythonRunnerIdempotencyConflictError } from '../../apps/python-runner/src/services/job-registry.mjs';
import { loadPythonRemoteRunnerConfig } from '../../apps/worker/src/config/python-remote-runner-config.mjs';
import { runPythonChallengeRemotely } from '../../apps/worker/src/services/python-remote-runner-client.mjs';

const secret = '0123456789abcdef0123456789abcdef';

test('Python Remote Runner署名はbody・timestamp・idempotency keyを改ざん検知する', () => {
  const timestamp = '1786584000000';
  const idempotencyKey = 'attempt-1';
  const body = '{"jobId":"attempt-1"}';
  const signature = createPythonRunnerSignature({ secret, timestamp, idempotencyKey, body });
  assert.equal(verifyPythonRunnerSignature({ secret, timestamp, idempotencyKey, body, signature }), true);
  assert.equal(verifyPythonRunnerSignature({ secret, timestamp, idempotencyKey, body: `${body}x`, signature }), false);
});

test('ProductionのRemote Runner URLはHTTPS以外を拒否する', () => {
  assert.throws(() => loadPythonRemoteRunnerConfig({
    NODE_ENV: 'production',
    PYTHON_REMOTE_RUNNER_URL: 'http://runner.internal:8090',
    PYTHON_REMOTE_RUNNER_SHARED_SECRET: secret
  }), /HTTPS/);
  const config = loadPythonRemoteRunnerConfig({
    NODE_ENV: 'production',
    PYTHON_REMOTE_RUNNER_URL: 'https://runner.internal',
    PYTHON_REMOTE_RUNNER_SHARED_SECRET: secret,
    PYTHON_REMOTE_RUNNER_TIMEOUT_MS: '9000'
  });
  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, 'https://runner.internal');
  assert.equal(config.timeoutMs, 9000);
});

test('Remote Runner URLのcredentials・query・fragmentを拒否する', () => {
  for (const url of [
    'https://user:pass@runner.internal',
    'https://runner.internal?token=x',
    'https://runner.internal#fragment'
  ]) {
    assert.throws(() => loadPythonRemoteRunnerConfig({
      NODE_ENV: 'production',
      PYTHON_REMOTE_RUNNER_URL: url,
      PYTHON_REMOTE_RUNNER_SHARED_SECRET: secret
    }));
  }
});

test('idempotency keyの同一payloadは同じ結果を再利用し、異なるpayloadを拒否する', async () => {
  let runs = 0;
  const registry = createPythonRunnerJobRegistry({ maxConcurrency: 1, maxQueuedJobs: 1, idempotencyTtlMs: 10000 });
  const first = await registry.execute({ idempotencyKey: 'a', payloadHash: 'hash-a', run: async () => ({ runs: ++runs }) });
  const second = await registry.execute({ idempotencyKey: 'a', payloadHash: 'hash-a', run: async () => ({ runs: ++runs }) });
  assert.deepEqual(first, { runs: 1 });
  assert.deepEqual(second, { runs: 1 });
  await assert.rejects(
    registry.execute({ idempotencyKey: 'a', payloadHash: 'hash-b', run: async () => ({}) }),
    PythonRunnerIdempotencyConflictError
  );
});

test('concurrency + queue上限を超えたjobをbusyで拒否する', async () => {
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const registry = createPythonRunnerJobRegistry({ maxConcurrency: 1, maxQueuedJobs: 0, idempotencyTtlMs: 10000 });
  const first = registry.execute({ idempotencyKey: 'a', payloadHash: 'a', run: () => blocker });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    registry.execute({ idempotencyKey: 'b', payloadHash: 'b', run: async () => ({}) }),
    PythonRunnerBusyError
  );
  release({ ok: true });
  await first;
});

test('Worker clientは署名付きrequestを送りraw secretをheaderへ露出しない', async () => {
  const challenge = { metadata: { slug: 'python-bugfix-score-buckets' } };
  const code = 'def classify_score(score):\n    return "A"\n';
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      ok: true,
      result: { status: 'completed', score: 100, durationMs: 1, logs: [], testResults: [], artifacts: [] }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await runPythonChallengeRemotely({
    challenge,
    code,
    jobContext: { attemptIdempotencyKey: 'attempt-key-1' },
    config: { enabled: true, baseUrl: 'http://localhost:8090', sharedSecret: secret, timeoutMs: 5000 },
    fetchImpl,
    now: () => 1786584000000
  });
  assert.equal(result.score, 100);
  assert.equal(request.url, 'http://localhost:8090/v1/jobs');
  assert.equal(request.init.headers['x-runner-idempotency-key'], 'attempt-key-1');
  assert.match(request.init.headers['x-runner-signature'], /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(request.init.body).code, code);
  assert.equal(Object.values(request.init.headers).some((value) => String(value).includes(secret)), false);
});
