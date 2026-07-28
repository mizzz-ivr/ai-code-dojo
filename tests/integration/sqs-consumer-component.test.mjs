import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueEventLogger } from '../../packages/queue/src/queue-event-logger.mjs';
import { createSqsQueueConsumer } from '../../apps/worker/src/services/sqs-queue-consumer.mjs';

const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo-grading';

const createCaptureLogger = () => {
  const events = [];
  return {
    events,
    logger: createQueueEventLogger({
      service: 'integration-test',
      now: () => '2026-07-28T00:00:00.000Z',
      writeLine: (_level, line) => events.push(JSON.parse(line))
    })
  };
};

test('SQS consumer componentは安全なno-opをackし不正messageを残す', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  const processed = [];
  const deliveries = [
    {
      MessageId: 'message-safe-noop',
      ReceiptHandle: 'receipt-safe-noop-sensitive',
      Body: JSON.stringify({
        schemaVersion: 1,
        submissionId: 'terminal-submission',
        gradingAttempt: 1,
        attemptIdempotencyKey: 'terminal-submission:attempt:1'
      }),
      Attributes: { ApproximateReceiveCount: '2' }
    },
    {
      MessageId: 'message-invalid-contract',
      ReceiptHandle: 'receipt-invalid-sensitive',
      Body: JSON.stringify({
        schemaVersion: 1,
        submissionId: 'invalid-submission',
        gradingAttempt: 1,
        attemptIdempotencyKey: 'invalid-submission:attempt:1',
        code: 'must-not-cross-queue-boundary'
      }),
      Attributes: { ApproximateReceiveCount: '4' }
    }
  ];
  let receiveIndex = 0;

  const consumer = createSqsQueueConsumer({
    client: {
      send: async (command) => {
        commands.push(command);
        if (command.type === 'receive') {
          const delivery = deliveries[receiveIndex];
          receiveIndex += 1;
          return { Messages: delivery ? [delivery] : [] };
        }
        return {};
      }
    },
    queueUrl,
    waitTimeSeconds: 20,
    visibilityTimeoutSeconds: 90,
    visibilityHeartbeatSeconds: 30,
    processMessage: async (message) => {
      processed.push(message);
      return { acknowledge: true, reason: 'conditional_claim_failed' };
    },
    receiveCommandFactory: (input) => ({ type: 'receive', input }),
    deleteCommandFactory: (input) => ({ type: 'delete', input }),
    changeVisibilityCommandFactory: (input) => ({ type: 'visibility', input }),
    eventLogger: capture.logger,
    setIntervalFn: () => ({ unref: () => {} }),
    clearIntervalFn: () => {},
    sleepFn: async () => {}
  });

  const safeNoop = await consumer.pollOnce();
  const invalid = await consumer.pollOnce();

  assert.deepEqual(safeNoop, { received: 1, deleted: 1, failed: 0, pollFailed: false });
  assert.deepEqual(invalid, { received: 1, deleted: 0, failed: 1, pollFailed: false });
  assert.equal(processed.length, 1);
  assert.equal(commands.filter((command) => command.type === 'delete').length, 1);
  assert.equal(capture.events.some((event) => event.event === 'queue.ack.succeeded'), true);
  const rejected = capture.events.find((event) => event.event === 'queue.delivery.rejected');
  assert.equal(rejected.reason, 'unknown_field');
  assert.equal(rejected.deliveryCount, 4);

  const serialized = JSON.stringify(capture.events);
  assert.equal(serialized.includes('must-not-cross-queue-boundary'), false);
  assert.equal(serialized.includes('receipt-safe-noop-sensitive'), false);
  assert.equal(serialized.includes('receipt-invalid-sensitive'), false);
  assert.equal(serialized.includes('attemptIdempotencyKey'), false);
  assert.equal(serialized.includes(queueUrl), false);
});
