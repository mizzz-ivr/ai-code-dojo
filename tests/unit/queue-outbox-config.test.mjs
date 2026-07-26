import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQueueOutboxConfig } from '../../apps/api/src/config/queue-outbox-config.mjs';

test('queue outboxは既定で無効かつ既定polling設定を返す', () => {
  assert.deepEqual(loadQueueOutboxConfig({}), {
    enabled: false,
    pollIntervalMs: 1000,
    batchSize: 25
  });
});

test('queue outboxは環境変数から設定を読み込む', () => {
  assert.deepEqual(loadQueueOutboxConfig({
    API_QUEUE_OUTBOX_ENABLED: 'true',
    API_QUEUE_OUTBOX_POLL_INTERVAL_MS: '250',
    API_QUEUE_OUTBOX_BATCH_SIZE: '10'
  }), {
    enabled: true,
    pollIntervalMs: 250,
    batchSize: 10
  });
});

test('queue outboxは不正な設定を拒否する', () => {
  assert.throws(
    () => loadQueueOutboxConfig({ API_QUEUE_OUTBOX_ENABLED: 'yes' }),
    /API_QUEUE_OUTBOX_ENABLED must be/
  );
  assert.throws(
    () => loadQueueOutboxConfig({ API_QUEUE_OUTBOX_POLL_INTERVAL_MS: '0' }),
    /API_QUEUE_OUTBOX_POLL_INTERVAL_MS must be a positive safe integer/
  );
  assert.throws(
    () => loadQueueOutboxConfig({ API_QUEUE_OUTBOX_BATCH_SIZE: '1.5' }),
    /API_QUEUE_OUTBOX_BATCH_SIZE must be a positive safe integer/
  );
});
