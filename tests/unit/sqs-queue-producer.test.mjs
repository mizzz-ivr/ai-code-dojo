import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSqsSendMessageInput,
  createSqsQueueProducer,
  SQS_QUEUE_TYPES
} from '../../packages/queue/src/sqs-queue-producer.mjs';
import { buildSubmissionQueueMessage } from '../../packages/queue/src/message-contract.mjs';
import { createQueueEventLogger } from '../../packages/queue/src/queue-event-logger.mjs';

const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/ai-code-dojo';

const createMessage = (overrides = {}) => buildSubmissionQueueMessage({
  submissionId: 'submission-1',
  gradingAttempt: 2,
  attemptIdempotencyKey: 'submission-1:attempt:2',
  correlationId: 'correlation-1',
  ...overrides
});

const createCaptureLogger = () => {
  const events = [];
  return {
    events,
    logger: createQueueEventLogger({
      service: 'test',
      now: () => '2026-07-26T00:00:00.000Z',
      writeLine: (_level, line) => events.push(JSON.parse(line))
    })
  };
};

test('Standard SQS inputはQueueUrlとversion付きMessageBodyだけを構築する', () => {
  const message = createMessage();
  const input = buildSqsSendMessageInput({
    queueUrl,
    queueType: SQS_QUEUE_TYPES.STANDARD,
    message
  });

  assert.deepEqual(input, {
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message)
  });
  assert.equal(input.MessageGroupId, undefined);
  assert.equal(input.MessageDeduplicationId, undefined);
});

test('FIFO SQS inputはsubmission単位group hashとattempt単位dedup hashを構築する', () => {
  const message = createMessage();
  const input = buildSqsSendMessageInput({
    queueUrl: `${queueUrl}.fifo`,
    queueType: SQS_QUEUE_TYPES.FIFO,
    message
  });
  const sameSubmissionNextAttempt = buildSqsSendMessageInput({
    queueUrl: `${queueUrl}.fifo`,
    queueType: SQS_QUEUE_TYPES.FIFO,
    message: createMessage({
      gradingAttempt: 3,
      attemptIdempotencyKey: 'submission-1:attempt:3'
    })
  });

  assert.match(input.MessageGroupId, /^[a-f0-9]{64}$/);
  assert.match(input.MessageDeduplicationId, /^[a-f0-9]{64}$/);
  assert.equal(input.MessageGroupId, sameSubmissionNextAttempt.MessageGroupId);
  assert.notEqual(input.MessageDeduplicationId, sameSubmissionNextAttempt.MessageDeduplicationId);
  assert.equal(input.MessageGroupId.includes('submission-1'), false);
  assert.equal(input.MessageDeduplicationId.includes('attempt:2'), false);
  assert.deepEqual(JSON.parse(input.MessageBody), message);
});

test('SQS producerはMessageId取得時だけ成功eventを出力する', async () => {
  const capture = createCaptureLogger();
  const commands = [];
  const producer = createSqsQueueProducer({
    client: {
      send: async (command) => {
        commands.push(command);
        return { MessageId: 'message-1' };
      }
    },
    commandFactory: (input) => ({ input }),
    queueUrl,
    queueType: SQS_QUEUE_TYPES.STANDARD,
    source: 'outbox',
    eventLogger: capture.logger
  });

  const message = createMessage();
  assert.equal(await producer.enqueue(message), true);
  assert.deepEqual(commands, [{ input: { QueueUrl: queueUrl, MessageBody: JSON.stringify(message) } }]);
  assert.deepEqual(capture.events, [{
    timestamp: '2026-07-26T00:00:00.000Z',
    level: 'info',
    service: 'test',
    event: 'queue.enqueue.succeeded',
    transport: 'sqs',
    provider: 'aws',
    queueType: 'standard',
    source: 'outbox',
    outcome: 'accepted',
    submissionId: 'submission-1',
    gradingAttempt: 2,
    correlationId: 'correlation-1',
    schemaVersion: 1
  }]);

  const serialized = JSON.stringify(capture.events);
  assert.equal(serialized.includes(queueUrl), false);
  assert.equal(serialized.includes('submission-1:attempt:2'), false);
});

test('SQS producerはSDK例外・MessageId欠落・不正messageを安全に失敗扱いする', async () => {
  const capture = createCaptureLogger();
  const message = createMessage();

  const failedProducer = createSqsQueueProducer({
    client: {
      send: async () => {
        const error = new Error('credential and endpoint detail must not be logged');
        error.name = 'CredentialsProviderError';
        throw error;
      }
    },
    commandFactory: (input) => ({ input }),
    queueUrl,
    eventLogger: capture.logger
  });
  assert.equal(await failedProducer.enqueue(message), false);

  const missingIdProducer = createSqsQueueProducer({
    client: { send: async () => ({}) },
    commandFactory: (input) => ({ input }),
    queueUrl,
    eventLogger: capture.logger
  });
  assert.equal(await missingIdProducer.enqueue(message), false);

  let called = false;
  const invalidProducer = createSqsQueueProducer({
    client: {
      send: async () => {
        called = true;
        return { MessageId: 'must-not-be-used' };
      }
    },
    commandFactory: (input) => ({ input }),
    queueUrl,
    eventLogger: capture.logger
  });
  assert.equal(await invalidProducer.enqueue({ ...message, code: 'must not be sent' }), false);
  assert.equal(called, false);

  assert.deepEqual(capture.events.map((event) => [event.reason, event.errorType]), [
    ['send_failed', 'CredentialsProviderError'],
    ['missing_message_id', 'SqsSendMessageResponseError'],
    ['unknown_field', 'TypeError']
  ]);
  const serialized = JSON.stringify(capture.events);
  assert.equal(serialized.includes('credential and endpoint detail'), false);
  assert.equal(serialized.includes(queueUrl), false);
  assert.equal(serialized.includes('submission-1:attempt:2'), false);
  assert.equal(serialized.includes('must not be sent'), false);
});

test('SQS producerは不正なqueue設定とclient contractを拒否する', () => {
  const message = createMessage();

  assert.throws(
    () => buildSqsSendMessageInput({ queueUrl: '', message }),
    /SQS queueUrl is required/
  );
  assert.throws(
    () => buildSqsSendMessageInput({ queueUrl, queueType: 'unknown', message }),
    /SQS queueType must be standard or fifo/
  );
  assert.throws(
    () => createSqsQueueProducer({ client: {}, commandFactory: () => ({}), queueUrl }),
    /SQS client.send is required/
  );
  assert.throws(
    () => createSqsQueueProducer({ client: { send: async () => ({}) }, queueUrl }),
    /SQS commandFactory is required/
  );
});
