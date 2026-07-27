import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueEventLogger } from '../../packages/queue/src/queue-event-logger.mjs';
import { createSqsQueueConsumer } from '../../apps/worker/src/services/sqs-queue-consumer.mjs';

const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading';
const message = {
  schemaVersion: 1,
  submissionId: 'submission-sqs-consumer-1',
  gradingAttempt: 2,
  attemptIdempotencyKey: 'submission-sqs-consumer-1:attempt:2',
  correlationId: 'correlation-sqs-consumer-1'
};
const validDelivery = {
  MessageId: 'message-1',
  ReceiptHandle: 'receipt-handle-sensitive-1',
  Body: JSON.stringify(message),
  Attributes: { ApproximateReceiveCount: '3' }
};

const createCaptureLogger = () => {
  const events = [];
  return {
    events,
    logger: createQueueEventLogger({
      service: 'worker-test',
      now: () => '2026-07-28T00:00:00.000Z',
      writeLine: (_level, line) => events.push(JSON.parse(line))
    })
  };
};

const createConsumer = ({
  send,
  processMessage = async () => ({ acknowledge: true }),
  eventLogger,
  setIntervalFn = () => ({ unref: () => {} }),
  clearIntervalFn = () => {}
}) => createSqsQueueConsumer({
  client: { send },
  queueUrl,
  waitTimeSeconds: 20,
  visibilityTimeoutSeconds: 90,
  visibilityHeartbeatSeconds: 30,
  processMessage,
  receiveCommandFactory: (input) => ({ type: 'receive', input }),
  deleteCommandFactory: (input) => ({ type: 'delete', input }),
  changeVisibilityCommandFactory: (input) => ({ type: 'visibility', input }),
  eventLogger,
  setIntervalFn,
  clearIntervalFn,
  sleepFn: async () => {}
});

test('SQS consumerはlong pollingで受信し処理完了後に最新ReceiptHandleでdeleteする', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  const processed = [];
  const consumer = createConsumer({
    eventLogger: capture.logger,
    processMessage: async (received) => {
      processed.push(received);
      return { acknowledge: true, reason: 'terminal_saved' };
    },
    send: async (command) => {
      commands.push(command);
      if (command.type === 'receive') return { Messages: [validDelivery] };
      return {};
    }
  });

  const summary = await consumer.pollOnce();

  assert.deepEqual(summary, { received: 1, deleted: 1, failed: 0, pollFailed: false });
  assert.deepEqual(processed, [message]);
  assert.deepEqual(commands, [
    {
      type: 'receive',
      input: {
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 90,
        AttributeNames: ['ApproximateReceiveCount']
      }
    },
    {
      type: 'delete',
      input: {
        QueueUrl: queueUrl,
        ReceiptHandle: validDelivery.ReceiptHandle
      }
    }
  ]);

  const accepted = capture.events.find((event) => event.event === 'queue.delivery.accepted');
  const ack = capture.events.find((event) => event.event === 'queue.ack.succeeded');
  assert.equal(accepted.transport, 'sqs');
  assert.equal(accepted.messageId, 'message-1');
  assert.equal(accepted.deliveryCount, 3);
  assert.equal(ack.outcome, 'deleted');

  const serialized = JSON.stringify(capture.events);
  assert.equal(serialized.includes(validDelivery.ReceiptHandle), false);
  assert.equal(serialized.includes(message.attemptIdempotencyKey), false);
  assert.equal(serialized.includes(queueUrl), false);
});

test('SQS consumerは不正JSONをdeleteせずDLQ redriveへ委ねる', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  const consumer = createConsumer({
    eventLogger: capture.logger,
    processMessage: async () => assert.fail('processMessage must not be called'),
    send: async (command) => {
      commands.push(command);
      if (command.type === 'receive') {
        return {
          Messages: [{
            MessageId: 'message-invalid-json',
            ReceiptHandle: 'receipt-invalid-json',
            Body: '{"secret":"must-not-be-logged"',
            Attributes: { ApproximateReceiveCount: '5' }
          }]
        };
      }
      assert.fail('DeleteMessage and ChangeMessageVisibility must not be called');
    }
  });

  const summary = await consumer.pollOnce();

  assert.deepEqual(summary, { received: 1, deleted: 0, failed: 1, pollFailed: false });
  assert.equal(commands.length, 1);
  const rejected = capture.events.find((event) => event.event === 'queue.delivery.rejected');
  assert.equal(rejected.reason, 'invalid_json');
  assert.equal(rejected.deliveryCount, 5);
  const serialized = JSON.stringify(capture.events);
  assert.equal(serialized.includes('must-not-be-logged'), false);
  assert.equal(serialized.includes('receipt-invalid-json'), false);
});

test('SQS consumerは処理例外時にdeleteせずraw errorを記録しない', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  const consumer = createConsumer({
    eventLogger: capture.logger,
    processMessage: async () => {
      const error = new Error('database password=must-not-be-logged');
      error.name = 'DatabaseUnavailableError';
      throw error;
    },
    send: async (command) => {
      commands.push(command);
      return {};
    }
  });

  const result = await consumer.processDelivery(validDelivery);

  assert.deepEqual(result, { accepted: true, deleted: false, reason: 'processing_failed' });
  assert.equal(commands.some((command) => command.type === 'delete'), false);
  const failed = capture.events.find((event) => event.event === 'queue.consumer.processing_failed');
  assert.equal(failed.errorType, 'DatabaseUnavailableError');
  assert.equal(JSON.stringify(capture.events).includes('must-not-be-logged'), false);
});

test('SQS consumerはDB永続状態未確認時にackを保留する', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  const consumer = createConsumer({
    eventLogger: capture.logger,
    processMessage: async () => ({
      acknowledge: false,
      reason: 'processing_ownership_lost'
    }),
    send: async (command) => {
      commands.push(command);
      return {};
    }
  });

  const result = await consumer.processDelivery(validDelivery);

  assert.deepEqual(result, {
    accepted: true,
    deleted: false,
    reason: 'processing_ownership_lost'
  });
  assert.equal(commands.some((command) => command.type === 'delete'), false);
  const deferred = capture.events.find((event) => event.event === 'queue.ack.deferred');
  assert.equal(deferred.reason, 'processing_ownership_lost');
});

test('SQS consumerは処理中にvisibilityを延長し延長失敗だけではackを止めない', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  let intervalCallback;
  let resolveProcessing;
  const processing = new Promise((resolve) => {
    resolveProcessing = resolve;
  });
  const consumer = createConsumer({
    eventLogger: capture.logger,
    setIntervalFn: (callback, delayMs) => {
      assert.equal(delayMs, 30_000);
      intervalCallback = callback;
      return { unref: () => {} };
    },
    clearIntervalFn: () => {},
    processMessage: async () => {
      await processing;
      return { acknowledge: true };
    },
    send: async (command) => {
      commands.push(command);
      if (command.type === 'visibility') {
        const error = new Error('sensitive network detail');
        error.name = 'VisibilityNetworkError';
        throw error;
      }
      return {};
    }
  });

  const deliveryPromise = consumer.processDelivery(validDelivery);
  await new Promise((resolve) => setImmediate(resolve));
  intervalCallback();
  await new Promise((resolve) => setImmediate(resolve));
  resolveProcessing();
  const result = await deliveryPromise;

  assert.equal(result.deleted, true);
  const visibilityCommand = commands.find((command) => command.type === 'visibility');
  assert.deepEqual(visibilityCommand.input, {
    QueueUrl: queueUrl,
    ReceiptHandle: validDelivery.ReceiptHandle,
    VisibilityTimeout: 90
  });
  const failed = capture.events.find((event) => event.event === 'queue.visibility.extension_failed');
  assert.equal(failed.errorType, 'VisibilityNetworkError');
  assert.equal(capture.events.some((event) => event.event === 'queue.ack.succeeded'), true);
  assert.equal(JSON.stringify(capture.events).includes('sensitive network detail'), false);
});

test('SQS consumerはReceiveMessage失敗を一般化して返す', async () => {
  const capture = createCaptureLogger();
  const consumer = createConsumer({
    eventLogger: capture.logger,
    send: async () => {
      const error = new Error('credential=must-not-be-logged');
      error.name = 'CredentialsProviderError';
      throw error;
    }
  });

  const summary = await consumer.pollOnce();

  assert.deepEqual(summary, { received: 0, deleted: 0, failed: 1, pollFailed: true });
  const failed = capture.events.find((event) => event.event === 'queue.consumer.poll_failed');
  assert.equal(failed.errorType, 'CredentialsProviderError');
  assert.equal(JSON.stringify(capture.events).includes('must-not-be-logged'), false);
});
