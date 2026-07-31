import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerQueueConsumerRuntime } from '../../apps/worker/src/services/queue-consumer-runtime.mjs';
import { enqueueSubmissionAttempt } from '../../packages/queue/src/submission-queue.mjs';

const sqsConfig = {
  transport: 'sqs',
  sqs: {
    region: 'ap-northeast-1',
    queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading',
    queueType: 'standard',
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 90,
    visibilityHeartbeatSeconds: 30,
    pollErrorDelayMs: 1000
  }
};

const retryMessage = {
  submissionId: 'submission-1',
  gradingAttempt: 2,
  attemptIdempotencyKey: 'attempt-key-2',
  source: 'application_retry'
};

const noopLogger = {
  info: () => true,
  warn: () => true,
  error: () => true
};

const commandFactories = {
  receiveCommandFactory: (input) => ({ type: 'receive', input }),
  deleteCommandFactory: (input) => ({ type: 'delete', input }),
  changeVisibilityCommandFactory: (input) => ({ type: 'visibility', input }),
  sendCommandFactory: (input) => ({ type: 'send', input })
};

test('HTTP runtimeはAWS clientを生成せずapplication retryをself-enqueueする', async () => {
  let clientFactoryCalled = false;
  const requests = [];
  const runtime = createWorkerQueueConsumerRuntime({
    config: { transport: 'http' },
    processMessage: async () => ({ acknowledge: true }),
    retryEnqueueBaseUrl: 'http://worker.internal:8081',
    httpFetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 202 };
    },
    eventLogger: noopLogger,
    sqsClientFactory: () => {
      clientFactoryCalled = true;
      return { send: async () => ({}) };
    }
  });

  assert.equal(runtime.transport, 'http');
  assert.equal(runtime.start(), false);
  assert.equal(await enqueueSubmissionAttempt(retryMessage), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://worker.internal:8081/jobs');
  assert.equal(JSON.parse(requests[0].options.body).gradingAttempt, 2);
  assert.equal(clientFactoryCalled, false);
  assert.equal(await runtime.close(), true);
  assert.equal(await runtime.close(), false);
});

test('SQS runtimeはconsumerとretry producerでclientを一度だけ生成して共有する', async () => {
  let clientFactoryCalls = 0;
  let destroyCalls = 0;
  let rejectReceive;
  const sentCommands = [];
  const runtime = createWorkerQueueConsumerRuntime({
    config: sqsConfig,
    processMessage: async () => ({ acknowledge: true }),
    eventLogger: noopLogger,
    sqsClientFactory: (options) => {
      clientFactoryCalls += 1;
      assert.deepEqual(options, { region: 'ap-northeast-1' });
      return {
        send: async (command) => {
          sentCommands.push(command);
          if (command.type === 'send') return { MessageId: 'message-1' };
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
  assert.equal(await enqueueSubmissionAttempt(retryMessage), true);
  const sendCommand = sentCommands.find((command) => command.type === 'send');
  assert.equal(sendCommand.input.QueueUrl, sqsConfig.sqs.queueUrl);
  assert.equal(JSON.parse(sendCommand.input.MessageBody).gradingAttempt, 2);
  assert.equal(runtime.start(), true);
  assert.equal(runtime.start(), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await runtime.close(), true);
  assert.equal(await runtime.close(), false);
  assert.equal(clientFactoryCalls, 1);
  assert.equal(destroyCalls, 1);
});

test('FIFO retry producerは既存のgroup・dedup契約を再利用する', async () => {
  let sendInput;
  const runtime = createWorkerQueueConsumerRuntime({
    config: {
      ...sqsConfig,
      sqs: {
        ...sqsConfig.sqs,
        queueUrl: `${sqsConfig.sqs.queueUrl}.fifo`,
        queueType: 'fifo'
      }
    },
    processMessage: async () => ({ acknowledge: true }),
    eventLogger: noopLogger,
    sqsClientFactory: () => ({
      send: async (command) => {
        if (command.type === 'send') {
          sendInput = command.input;
          return { MessageId: 'message-fifo' };
        }
        return { Messages: [] };
      },
      destroy: () => {}
    }),
    ...commandFactories,
    sleepFn: async () => {}
  });

  assert.equal(await runtime.enqueue(retryMessage), true);
  assert.equal(typeof sendInput.MessageGroupId, 'string');
  assert.equal(sendInput.MessageGroupId.length, 64);
  assert.equal(typeof sendInput.MessageDeduplicationId, 'string');
  assert.equal(sendInput.MessageDeduplicationId.length, 64);
  assert.equal(await runtime.close(), true);
});

test('SQS retry producerはSendMessage失敗をfalseとして返す', async () => {
  const events = [];
  const eventLogger = {
    info: (event, context) => events.push({ level: 'info', event, context }),
    warn: (event, context) => events.push({ level: 'warn', event, context }),
    error: (event, context) => events.push({ level: 'error', event, context })
  };
  const runtime = createWorkerQueueConsumerRuntime({
    config: sqsConfig,
    processMessage: async () => ({ acknowledge: true }),
    eventLogger,
    sqsClientFactory: () => ({
      send: async (command) => {
        if (command.type === 'send') {
          const error = new Error('sensitive sdk message');
          error.name = 'AccessDeniedException';
          throw error;
        }
        return { Messages: [] };
      },
      destroy: () => {}
    }),
    ...commandFactories,
    sleepFn: async () => {}
  });

  assert.equal(await runtime.enqueue(retryMessage), false);
  const failure = events.find((event) => event.context?.reason === 'send_failed');
  assert.equal(failure.context.errorType, 'AccessDeniedException');
  assert.equal(JSON.stringify(events).includes('sensitive sdk message'), false);
  assert.equal(await runtime.close(), true);
});

test('SQS runtimeはqueue type欠落をAWS client生成前に拒否する', () => {
  let clientFactoryCalled = false;
  assert.throws(
    () => createWorkerQueueConsumerRuntime({
      config: {
        ...sqsConfig,
        sqs: { ...sqsConfig.sqs, queueType: undefined }
      },
      processMessage: async () => ({ acknowledge: true }),
      sqsClientFactory: () => {
        clientFactoryCalled = true;
        return { send: async () => ({}) };
      },
      ...commandFactories
    }),
    /queueType must be standard or fifo/
  );
  assert.equal(clientFactoryCalled, false);
});

test('SQS runtimeは不正なclient factoryを起動前に拒否する', () => {
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

test('SQS runtimeは不正なsend command factoryを起動前に拒否する', () => {
  assert.throws(
    () => createWorkerQueueConsumerRuntime({
      config: sqsConfig,
      processMessage: async () => ({ acknowledge: true }),
      sqsClientFactory: () => ({ send: async () => ({}) }),
      sendCommandFactory: null,
      receiveCommandFactory: commandFactories.receiveCommandFactory,
      deleteCommandFactory: commandFactories.deleteCommandFactory,
      changeVisibilityCommandFactory: commandFactories.changeVisibilityCommandFactory
    }),
    /send command factory is required/
  );
});
