import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const API_PORT = 18130;
const WEB_PORT = 18131;

const waitForWeb = async (retries = 40) => {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(`http://localhost:${WEB_PORT}/login`);
      if (response.ok) return;
    } catch {
      // server startup中は再試行する
    }
    await sleep(100);
  }
  throw new Error('web startup timeout');
};

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(API_PORT, '127.0.0.1', resolve);
});

const close = (server) => new Promise((resolve) => server.close(resolve));

test('Submission APIが400を返したときWebはエラーを表示しundefinedへredirectしない', async (t) => {
  const fakeApi = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/submissions') {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: 'このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。'
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await listen(fakeApi);

  const web = spawn(process.execPath, ['apps/web/src/server.mjs'], {
    env: {
      ...process.env,
      WEB_PORT: String(WEB_PORT),
      API_BASE_URL: `http://127.0.0.1:${API_PORT}`
    },
    stdio: 'ignore'
  });

  t.after(async () => {
    web.kill('SIGKILL');
    await close(fakeApi);
  });

  await waitForWeb();

  const response = await fetch(`http://localhost:${WEB_PORT}/submit`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export function sum() { return 0; }'
    })
  });
  const html = await response.text();

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
  assert.match(html, /このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。/);
  assert.equal(html.includes('/submissions/undefined'), false);
  assert.match(html, /問題へ戻る/);
});
