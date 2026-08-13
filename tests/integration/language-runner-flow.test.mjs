import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const API_PORT = 18140;
const WORKER_PORT = 18141;

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

const submitAndAssertSuccess = async ({ challengeSlug, language, code }) => {
  const response = await fetch(`http://localhost:${API_PORT}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeSlug, language, code })
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
};

test('SQL・HTML/CSSは実採点しPythonは本番公開前のため拒否する', async (t) => {
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

  const pythonResponse = await fetch(`http://localhost:${API_PORT}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeSlug: 'python-bugfix-score-buckets',
      language: 'python',
      code: 'def classify_score(score):\n    return "A"\n'
    })
  });
  assert.equal(pythonResponse.status, 400);

  await submitAndAssertSuccess({
    challengeSlug: 'sql-monthly-sales',
    language: 'sql',
    code: `SELECT
  substr(created_at, 1, 7) AS month,
  SUM(amount) AS total_amount
FROM orders
GROUP BY substr(created_at, 1, 7)
ORDER BY month ASC;`
  });

  await submitAndAssertSuccess({
    challengeSlug: 'html-css-feature-profile-card',
    language: 'html-css',
    code: `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <style>
    .profile-card { display: grid; grid-template-columns: 96px 1fr; gap: 16px; }
    @media (max-width: 600px) { .profile-card { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <article class="profile-card">
    <img src="avatar.png" alt="Mika Satoのプロフィール画像" />
    <div><h2>Mika Sato</h2><p>Frontend Engineer</p></div>
  </article>
</body>
</html>`
  });
});
