import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueRuntime } from '../../apps/api/src/services/queue-runtime.mjs';

const noopLogger = {
  info: () => true,
  warn: () => true,
  error: () => true
};

const sqsConfig = {
  transport: 'sqs',
  sqs: {
    region: 'ap-northeast-1',
    queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading',
    queueType: 'standard'
  }
};

test('HTTP runtimeはSQS clientを生成しない', () => {
  let sqsFactoryCalled = false;
  const runtime = createQueueRuntime({
    config: { transport: 'http' },
    sqsClientFactory: () => {
      sqsFactoryCalled = true;
      return { send: async () => ({ MessageId: 'unused' }) };
    },
    eventLoggerFactory: () => noopLogger
  });

  assert.equal(runtime.transport, 'http');
  assert.equal(sqsFactoryCalled, false);
  assert.equal(runtime.close(), false);
});

test('SQS runtimeはclientを一度だけ生成して複数enqueueで再利用する', async () => {
  const commands = [];
  let clientFactoryCalls = 0;
  let destroyCalls = 0;
  const runtime = createQueueRuntime({
    config: sqsConfig,
    sqsClientFactory: (options) => {
      clientFactoryCalls += 1;
      assert.deepEqual(options, { region: 'ap-northeast-1' });
      return {
        send: async (command) => {
          commands.push(command);
          return { MessageId: `message-${commands.length}` };
        },
        destroy: () => {
          destroyCalls += 1;
        }
      };
    },
    sqsCommandFactory: (input) => ({ input }),
    eventLoggerFactory: () => noopLogger
  });

  const first = await runtime.enqueue({
    submissionId: 'submission-1',
    gradingAttempt: 1,
    attemptIdempotencyKey: 'submission-1:attempt:1',
    source: 'submission'
  });
  const second = await runtime.enqueue({
    submissionId: 'submission-2',
    gradingAttempt: 2,
    attemptIdempotencyKey: 'submission-2:attempt:2',
    source: 'outbox'
  });

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(clientFactoryCalls, 1);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].input.QueueUrl, sqsConfig.sqs.queueUrl);
  assert.deepEqual(JSON.parse(commands[0].input.MessageBody), {
    schemaVersion: 1,
    submissionId: 'submission-1',
    gradingAttempt: 1,
    attemptIdempotencyKey: 'submission-1:attempt:1'
  });
  assert.equal(runtime.close(), true);
  assert.equal(destroyCalls, 1);
});

test('SQS runtimeはmessage構築失敗eventをSQS transportとして記録する', async () => {
  const warnings = [];
  let sendCalled = false;
  const logger = {
    info: () => true,
    warn: (event, details) => {
      warnings.push({ event, details });
      return true;
    },
    error: () => true
  };
  const runtime = createQueueRuntime({
    config: sqsConfig,
    sqsClientFactory: () => ({
      send: async () => {
        sendCalled = true;
        return { MessageId: 'unexpected' };
      }
    }),
    sqsCommandFactory: (input) => ({ input }),
    eventLoggerFactory: () => logger
  });

  const result = await runtime.enqueue({
    submissionId: '',
    gradingAttempt: 1,
    attemptIdempotencyKey: 'attempt-1'
  });

  assert.equal(result, false);
  assert.equal(sendCalled, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].details.transport, 'sqs');
  assert.equal(warnings[0].details.reason, 'message_build_failed');
});

test('SQS runtimeは不正なclient factoryを起動時に拒否する', () => {
  assert.throws(
    () => createQueueRuntime({
      config: sqsConfig,
      sqsClientFactory: () => ({}),
      sqsCommandFactory: (input) => ({ input }),
      eventLoggerFactory: () => noopLogger
    }),
    /client factory must return a client with send/
  );
});

test('SQS runtimeのdestroy失敗はshutdownへ例外を伝播しない', () => {
  const runtime = createQueueRuntime({
    config: sqsConfig,
    sqsClientFactory: () => ({
      send: async () => ({ MessageId: 'message-1' }),
      destroy: () => {
        throw new Error('sensitive destroy detail');
      }
    }),
    sqsCommandFactory: (input) => ({ input }),
    eventLoggerFactory: () => noopLogger
  });

  assert.equal(runtime.close(), false);
});
