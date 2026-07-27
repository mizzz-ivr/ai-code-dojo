import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchQueueOutboxBatch } from '../../apps/api/src/services/queue-outbox-dispatcher.mjs';
import { buildSubmissionQueueMessage } from '../../packages/queue/src/message-contract.mjs';
import { createQueueEventLogger } from '../../packages/queue/src/queue-event-logger.mjs';
import { createSqsQueueProducer } from '../../packages/queue/src/sqs-queue-producer.mjs';

const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo';

const createCaptureLogger = () => {
  const events = [];
  return {
    events,
    logger: createQueueEventLogger({
      service: 'integration-test',
      now: () => '2026-07-26T00:00:00.000Z',
      writeLine: (_level, line) => events.push(JSON.parse(line))
    })
  };
};

test('outbox dispatcherは注入されたSQS producerでpending messageをpublishできる', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  const published = [];
  const message = buildSubmissionQueueMessage({
    submissionId: 'submission-sqs-1',
    gradingAttempt: 1,
    attemptIdempotencyKey: 'submission-sqs-1:attempt:1',
    correlationId: 'correlation-sqs-1'
  });
  const producer = createSqsQueueProducer({
    client: {
      send: async (command) => {
        commands.push(command);
        return { MessageId: 'sqs-message-1' };
      }
    },
    commandFactory: (input) => ({ input }),
    queueUrl,
    source: 'outbox',
    eventLogger: capture.logger
  });

  const summary = await dispatchQueueOutboxBatch({
    limit: 10,
    trigger: 'component_test',
    transport: 'sqs',
    eventLogger: capture.logger,
    listPending: async () => [{
      id: 'outbox-sqs-1',
      submissionId: message.submissionId,
      gradingAttempt: message.gradingAttempt,
      message,
      messageErrorType: null,
      status: 'pending'
    }],
    enqueue: async ({
      submissionId,
      gradingAttempt,
      attemptIdempotencyKey,
      correlationId
    }) => producer.enqueue(buildSubmissionQueueMessage({
      submissionId,
      gradingAttempt,
      attemptIdempotencyKey,
      correlationId
    })),
    markPublished: async (id) => {
      published.push(id);
      return { id, status: 'published' };
    },
    recordFailure: async () => {
      assert.fail('recordFailure must not be called on SQS publish success');
    }
  });

  assert.deepEqual(summary, { scanned: 1, published: 1, failed: 0 });
  assert.deepEqual(published, ['outbox-sqs-1']);
  assert.deepEqual(commands, [{
    input: {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    }
  }]);

  const enqueueEvent = capture.events.find((event) => event.event === 'queue.enqueue.succeeded');
  assert.equal(enqueueEvent.transport, 'sqs');
  assert.equal(enqueueEvent.provider, 'aws');
  assert.equal(enqueueEvent.queueType, 'standard');

  const publishEvent = capture.events.find((event) => event.event === 'queue.outbox.publish_succeeded');
  const dispatchEvent = capture.events.find((event) => event.event === 'queue.outbox.dispatch_completed');
  assert.equal(publishEvent.transport, 'sqs');
  assert.equal(dispatchEvent.transport, 'sqs');
  assert.equal(dispatchEvent.trigger, 'component_test');

  const serialized = JSON.stringify(capture.events);
  assert.equal(serialized.includes(queueUrl), false);
  assert.equal(serialized.includes('submission-sqs-1:attempt:1'), false);
  assert.equal(serialized.includes('hiddenTests'), false);
  assert.equal(serialized.includes('code'), false);
});
