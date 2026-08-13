import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPythonRunnerServer } from '../../apps/python-runner/src/server.mjs';
import { createPythonRunnerSignature } from '../../packages/runner-sdk/src/python-remote-auth.mjs';
import { runPythonChallengeRemotely } from '../../apps/worker/src/services/python-remote-runner-client.mjs';

const enabled = process.env.RUNNER_PYTHON_CONTAINER_CONTRACT === '1';
const secret = 'integration-secret-0123456789abcdef0123456789';
const solution = `def classify_score(score: int) -> str:
    if score < 0 or score > 100:
        raise ValueError("score must be between 0 and 100")
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 60:
        return "C"
    return "D"
`;

const startServer = async () => {
  const server = createPythonRunnerServer({
    config: {
      port: 0,
      sharedSecret: secret,
      problemsRoot: new URL('../../problems/examples', import.meta.url).pathname,
      maxConcurrency: 1,
      maxQueuedJobs: 2,
      idempotencyTtlMs: 60000,
      maxClockSkewMs: 60000,
      maxRequestBytes: 98304
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

test('Worker client → Remote Runner → Python sandboxを実HTTPで採点する', { skip: !enabled }, async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => server.close());

  const challenge = { metadata: { slug: 'python-bugfix-score-buckets' } };
  const config = { enabled: true, baseUrl, sharedSecret: secret, timeoutMs: 20000 };
  const result = await runPythonChallengeRemotely({
    challenge,
    code: solution,
    jobContext: { attemptIdempotencyKey: 'integration-attempt-1' },
    config
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.score, 100);
  assert.equal(result.testResults.every((entry) => entry.passed), true);
  assert.equal(result.logs.some((entry) => /hidden.*source/i.test(entry)), true);
});

test('Remote Runnerは署名不正とidempotency payload差し替えを拒否する', { skip: !enabled }, async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => server.close());

  const badAuth = await fetch(`${baseUrl}/v1/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-timestamp': String(Date.now()),
      'x-runner-idempotency-key': 'bad-auth',
      'x-runner-signature': '0'.repeat(64)
    },
    body: JSON.stringify({ jobId: 'bad-auth', challengeSlug: 'python-bugfix-score-buckets', code: solution })
  });
  assert.equal(badAuth.status, 401);

  const key = 'same-attempt';
  const timestamp = String(Date.now());
  const body1 = JSON.stringify({ jobId: key, challengeSlug: 'python-bugfix-score-buckets', code: solution });
  const signedHeaders = (body) => ({
    'content-type': 'application/json',
    'x-runner-timestamp': timestamp,
    'x-runner-idempotency-key': key,
    'x-runner-signature': createPythonRunnerSignature({ secret, timestamp, idempotencyKey: key, body })
  });
  const first = await fetch(`${baseUrl}/v1/jobs`, { method: 'POST', headers: signedHeaders(body1), body: body1 });
  assert.equal(first.status, 200);

  const body2 = JSON.stringify({ jobId: key, challengeSlug: 'python-bugfix-score-buckets', code: `${solution}\n# changed` });
  const conflict = await fetch(`${baseUrl}/v1/jobs`, { method: 'POST', headers: signedHeaders(body2), body: body2 });
  assert.equal(conflict.status, 409);
});
