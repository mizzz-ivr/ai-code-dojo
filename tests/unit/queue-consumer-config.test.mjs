import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkerQueueConsumerConfig,
  WORKER_QUEUE_CONSUMERS
} from '../../apps/worker/src/config/queue-consumer-config.mjs';
import { SQS_QUEUE_TYPES } from '../../packages/queue/src/sqs-queue-producer.mjs';

const validSqsEnv = {
  WORKER_QUEUE_CONSUMER: 'sqs',
  WORKER_SQS_REGION: 'ap-northeast-1',
  WORKER_SQS_QUEUE_URL: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading',
  WORKER_SQS_WAIT_TIME_SECONDS: '20',
  WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS: '90',
  WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS: '30'
};

test('Worker queue consumerは既定でHTTPを選択しSQS設定を参照しない', () => {
  assert.deepEqual(loadWorkerQueueConsumerConfig({
    WORKER_SQS_QUEUE_URL: 'not-a-url',
    WORKER_SQS_WAIT_TIME_SECONDS: 'invalid'
  }), {
    transport: WORKER_QUEUE_CONSUMERS.HTTP
  });
});

test('Worker queue consumerはStandard SQS設定を読み込む', () => {
  assert.deepEqual(loadWorkerQueueConsumerConfig(validSqsEnv), {
    transport: WORKER_QUEUE_CONSUMERS.SQS,
    sqs: {
      region: 'ap-northeast-1',
      queueUrl: validSqsEnv.WORKER_SQS_QUEUE_URL,
      queueType: SQS_QUEUE_TYPES.STANDARD,
      waitTimeSeconds: 20,
      visibilityTimeoutSeconds: 90,
      visibilityHeartbeatSeconds: 30,
      pollErrorDelayMs: 1000
    }
  });
});

test('Worker queue consumerはQueueUrl suffixからFIFOを判定する', () => {
  const queueUrl = `${validSqsEnv.WORKER_SQS_QUEUE_URL}.fifo`;
  const config = loadWorkerQueueConsumerConfig({
    ...validSqsEnv,
    WORKER_SQS_QUEUE_URL: queueUrl
  });

  assert.equal(config.sqs.queueUrl, queueUrl);
  assert.equal(config.sqs.queueType, SQS_QUEUE_TYPES.FIFO);
});

test('Worker SQS consumerは必須設定欠落を拒否する', () => {
  for (const name of [
    'WORKER_SQS_REGION',
    'WORKER_SQS_QUEUE_URL',
    'WORKER_SQS_WAIT_TIME_SECONDS',
    'WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS',
    'WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS'
  ]) {
    const env = { ...validSqsEnv };
    delete env[name];
    assert.throws(() => loadWorkerQueueConsumerConfig(env), new RegExp(`${name} is required`));
  }
});

test('Worker SQS consumerはHTTPS QueueUrlと機微情報非混入を要求する', () => {
  for (const queueUrl of [
    'http://sqs.ap-northeast-1.amazonaws.com/123/queue',
    'https://user:password@sqs.ap-northeast-1.amazonaws.com/123/queue',
    'https://sqs.ap-northeast-1.amazonaws.com/123/queue?token=secret',
    'https://sqs.ap-northeast-1.amazonaws.com/123/queue#fragment',
    'https://sqs.ap-northeast-1.amazonaws.com/'
  ]) {
    assert.throws(
      () => loadWorkerQueueConsumerConfig({ ...validSqsEnv, WORKER_SQS_QUEUE_URL: queueUrl }),
      /WORKER_SQS_QUEUE_URL/
    );
  }
});

test('Worker SQS consumerはlong pollingとvisibility境界を検証する', () => {
  assert.throws(
    () => loadWorkerQueueConsumerConfig({ ...validSqsEnv, WORKER_SQS_WAIT_TIME_SECONDS: '21' }),
    /between 1 and 20/
  );
  assert.throws(
    () => loadWorkerQueueConsumerConfig({ ...validSqsEnv, WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS: '43201' }),
    /between 1 and 43200/
  );
  assert.throws(
    () => loadWorkerQueueConsumerConfig({
      ...validSqsEnv,
      WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS: '60',
      WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS: '21'
    }),
    /at most one third/
  );
  assert.throws(
    () => loadWorkerQueueConsumerConfig({ ...validSqsEnv, WORKER_SQS_POLL_ERROR_DELAY_MS: '0' }),
    /positive safe integer/
  );
});

test('Worker queue consumerは未対応transportを拒否する', () => {
  assert.throws(
    () => loadWorkerQueueConsumerConfig({ WORKER_QUEUE_CONSUMER: 'kafka' }),
    /WORKER_QUEUE_CONSUMER must be one of/
  );
});
