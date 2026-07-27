import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const waitForExit = (child, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error('API process did not exit after invalid queue transport configuration'));
  }, timeoutMs);
  timer.unref?.();

  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal });
  });
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

test('APIはoutbox無効のSQS transport設定を起動前に拒否する', async () => {
  const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/sensitive-queue-name';
  const child = spawn(process.execPath, ['apps/api/src/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: '18190',
      API_QUEUE_TRANSPORT: 'sqs',
      API_QUEUE_OUTBOX_ENABLED: '0',
      API_SQS_REGION: 'ap-northeast-1',
      API_SQS_QUEUE_URL: queueUrl,
      API_SQS_QUEUE_TYPE: 'standard'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });

  const result = await waitForExit(child);

  assert.notEqual(result.code, 0);
  assert.match(output, /API_QUEUE_OUTBOX_ENABLED must be true/);
  assert.equal(output.includes(queueUrl), false);
  assert.equal(output.includes('AWS_SECRET_ACCESS_KEY'), false);
});
