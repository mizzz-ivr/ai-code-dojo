import test from 'node:test';
import assert from 'node:assert/strict';
import { createPythonRunnerSignature } from '../../packages/runner-sdk/src/python-remote-auth.mjs';

const enabled = process.env.RUNNER_PYTHON_SERVICE_IMAGE_CONTRACT === '1';
const baseUrl = process.env.PYTHON_RUNNER_SERVICE_BASE_URL ?? 'http://127.0.0.1:18090';
const secret = process.env.PYTHON_RUNNER_SERVICE_SHARED_SECRET ?? '';
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

test('containerized Python Runner serviceはhealthと実sandbox採点を完遂する', { skip: !enabled }, async () => {
  assert.ok(secret.length >= 32, 'integration shared secret must be configured');
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'python-runner');

  const idempotencyKey = 'service-image-contract-1';
  const timestamp = String(Date.now());
  const body = JSON.stringify({
    jobId: idempotencyKey,
    challengeSlug: 'python-bugfix-score-buckets',
    code: solution
  });
  const signature = createPythonRunnerSignature({ secret, timestamp, idempotencyKey, body });
  const response = await fetch(`${baseUrl}/v1/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-timestamp': timestamp,
      'x-runner-idempotency-key': idempotencyKey,
      'x-runner-signature': signature
    },
    body
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.result.status, 'completed');
  assert.equal(payload.result.score, 100);
  assert.equal(payload.result.testResults.every((entry) => entry.passed), true);
  assert.deepEqual(payload.result.logs, [
    '[visible] 4/4 cases passed.',
    '[hidden] hidden test source and logs are not exposed.'
  ]);
});
