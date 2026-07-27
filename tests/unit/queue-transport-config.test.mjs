import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadQueueTransportConfig,
  QUEUE_TRANSPORTS
} from '../../apps/api/src/config/queue-transport-config.mjs';

const validSqsEnv = {
  API_QUEUE_TRANSPORT: 'sqs',
  API_SQS_REGION: 'ap-northeast-1',
  API_SQS_QUEUE_URL: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading',
  API_SQS_QUEUE_TYPE: 'standard'
};

test('queue transportは既定でHTTPを選択しSQS設定を参照しない', () => {
  assert.deepEqual(loadQueueTransportConfig({
    API_SQS_REGION: 'invalid region',
    API_SQS_QUEUE_URL: 'not-a-url'
  }), {
    transport: QUEUE_TRANSPORTS.HTTP
  });
});

test('queue transportはoutbox有効時にStandard SQS設定を読み込む', () => {
  assert.deepEqual(loadQueueTransportConfig(validSqsEnv, { outboxEnabled: true }), {
    transport: QUEUE_TRANSPORTS.SQS,
    sqs: {
      region: 'ap-northeast-1',
      queueUrl: validSqsEnv.API_SQS_QUEUE_URL,
      queueType: 'standard'
    }
  });
});

test('queue transportはFIFO queue名とqueue typeの整合性を検証する', () => {
  const fifoUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading.fifo';
  assert.deepEqual(loadQueueTransportConfig({
    ...validSqsEnv,
    API_SQS_QUEUE_URL: fifoUrl,
    API_SQS_QUEUE_TYPE: 'fifo'
  }, { outboxEnabled: true }), {
    transport: QUEUE_TRANSPORTS.SQS,
    sqs: {
      region: 'ap-northeast-1',
      queueUrl: fifoUrl,
      queueType: 'fifo'
    }
  });

  assert.throws(
    () => loadQueueTransportConfig({
      ...validSqsEnv,
      API_SQS_QUEUE_URL: fifoUrl
    }, { outboxEnabled: true }),
    /must not end with \.fifo/
  );
  assert.throws(
    () => loadQueueTransportConfig({
      ...validSqsEnv,
      API_SQS_QUEUE_TYPE: 'fifo'
    }, { outboxEnabled: true }),
    /must end with \.fifo/
  );
});

test('queue transportはSQS利用時のoutbox・region・HTTPS QueueUrlを必須化する', () => {
  assert.throws(
    () => loadQueueTransportConfig(validSqsEnv),
    /API_QUEUE_OUTBOX_ENABLED must be true/
  );
  assert.throws(
    () => loadQueueTransportConfig({
      ...validSqsEnv,
      API_SQS_REGION: ''
    }, { outboxEnabled: true }),
    /API_SQS_REGION is required/
  );
  assert.throws(
    () => loadQueueTransportConfig({
      ...validSqsEnv,
      API_SQS_QUEUE_URL: 'http://localhost:4566/123456789012/queue'
    }, { outboxEnabled: true }),
    /absolute HTTPS URL/
  );
  assert.throws(
    () => loadQueueTransportConfig({
      ...validSqsEnv,
      API_SQS_QUEUE_URL: `${validSqsEnv.API_SQS_QUEUE_URL}?token=sensitive`
    }, { outboxEnabled: true }),
    /without credentials, query, or fragment/
  );
});

test('queue transportは未対応transportとqueue typeを拒否する', () => {
  assert.throws(
    () => loadQueueTransportConfig({ API_QUEUE_TRANSPORT: 'redis' }),
    /API_QUEUE_TRANSPORT must be one of/
  );
  assert.throws(
    () => loadQueueTransportConfig({
      ...validSqsEnv,
      API_SQS_QUEUE_TYPE: 'express'
    }, { outboxEnabled: true }),
    /API_SQS_QUEUE_TYPE must be one of/
  );
});
