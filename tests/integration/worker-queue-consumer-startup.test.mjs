import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const waitForExit = (child, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error('Worker process did not exit after invalid SQS consumer configuration'));
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

test('Workerは不完全なSQS consumer設定をlisten前に拒否する', async () => {
  const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/sensitive-consumer-queue';
  const child = spawn(process.execPath, ['apps/worker/src/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_PORT: '18191',
      WORKER_QUEUE_CONSUMER: 'sqs',
      WORKER_SQS_REGION: 'ap-northeast-1',
      WORKER_SQS_QUEUE_URL: queueUrl,
      WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS: '90',
      WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS: '30'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });

  const result = await waitForExit(child);

  assert.notEqual(result.code, 0);
  assert.match(output, /WORKER_SQS_WAIT_TIME_SECONDS is required/);
  assert.equal(output.includes(queueUrl), false);
  assert.equal(output.includes('AWS_SECRET_ACCESS_KEY'), false);
  assert.equal(output.includes('worker listening'), false);
});
