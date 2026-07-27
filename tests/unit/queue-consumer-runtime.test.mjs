import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerQueueConsumerRuntime } from '../../apps/worker/src/services/queue-consumer-runtime.mjs';

const sqsConfig = {
  transport: 'sqs',
  sqs: {
    region: 'ap-northeast-1',
    queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading',
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 90,
    visibilityHeartbeatSeconds: 30,
    pollErrorDelayMs: 1000
  }
};

const noopLogger = {
  info: () => true,
  warn: () => true,
  error: () => true
};

const commandFactories = {
  receiveCommandFactory: (input) => ({ type: 'receive', input }),
  deleteCommandFactory: (input) => ({ type: 'delete', input }),
  changeVisibilityCommandFactory: (input) => ({ type: 'visibility', input })
};

test('HTTP consumer runtimeはAWS clientを生成しない', async () => {
  let clientFactoryCalled = false;
  const runtime = createWorkerQueueConsumerRuntime({
    config: { transport: 'http' },
    processMessage: async () => ({ acknowledge: true }),
    sqsClientFactory: () => {
      clientFactoryCalled = true;
      return { send: async () => ({}) };
    }
  });

  assert.equal(runtime.transport, 'http');
  assert.equal(runtime.start(), false);
  assert.equal(await runtime.close(), false);
  assert.equal(clientFactoryCalled, false);
});

test('SQS consumer runtimeはclientを一度だけ生成してpoll停止時にdestroyする', async () => {
  let clientFactoryCalls = 0;
  let destroyCalls = 0;
  let rejectReceive;
  const runtime = createWorkerQueueConsumerRuntime({
    config: sqsConfig,
    processMessage: async () => ({ acknowledge: true }),
    eventLogger: noopLogger,
    sqsClientFactory: (options) => {
      clientFactoryCalls += 1;
      assert.deepEqual(options, { region: 'ap-northeast-1' });
      return {
        send: async (command) => {
          if (command.type !== 'receive') return {};
          return new Promise((_resolve, reject) => {
            rejectReceive = reject;
          });
        },
        destroy: () => {
          destroyCalls += 1;
          const error = new Error('client destroyed');
          error.name = 'AbortError';
          rejectReceive?.(error);
        }
      };
    },
    ...commandFactories,
    sleepFn: async () => {}
  });

  assert.equal(runtime.transport, 'sqs');
  assert.equal(runtime.start(), true);
  assert.equal(runtime.start(), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await runtime.close(), true);
  assert.equal(await runtime.close(), false);
  assert.equal(clientFactoryCalls, 1);
  assert.equal(destroyCalls, 1);
});

test('SQS consumer runtimeは不正なclient factoryを起動前に拒否する', () => {
  assert.throws(
    () => createWorkerQueueConsumerRuntime({
      config: sqsConfig,
      processMessage: async () => ({ acknowledge: true }),
      sqsClientFactory: () => ({}),
      ...commandFactories
    }),
    /client factory must return a client with send/
  );
});
