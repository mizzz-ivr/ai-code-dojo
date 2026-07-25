import test from 'node:test';
import assert from 'node:assert/strict';
import { getApplicationRetryBackoffConfig } from '../../apps/worker/src/config/application-retry-backoff-config.mjs';

test('application retry backoffは既定で無効かつ既定delayを返す', () => {
  assert.deepEqual(getApplicationRetryBackoffConfig({}), {
    enabled: false,
    baseDelayMs: 5_000,
    maxDelayMs: 60_000
  });
});

test('application retry backoffは環境変数から設定を読み込む', () => {
  assert.deepEqual(getApplicationRetryBackoffConfig({
    WORKER_APPLICATION_RETRY_BACKOFF_ENABLED: '1',
    WORKER_APPLICATION_RETRY_BASE_DELAY_MS: '250',
    WORKER_APPLICATION_RETRY_MAX_DELAY_MS: '4000'
  }), {
    enabled: true,
    baseDelayMs: 250,
    maxDelayMs: 4000
  });
});

test('application retry backoffは不正なdelay設定を拒否する', () => {
  assert.throws(
    () => getApplicationRetryBackoffConfig({ WORKER_APPLICATION_RETRY_BASE_DELAY_MS: '0' }),
    /WORKER_APPLICATION_RETRY_BASE_DELAY_MS must be a positive integer/
  );
  assert.throws(
    () => getApplicationRetryBackoffConfig({ WORKER_APPLICATION_RETRY_MAX_DELAY_MS: '100.5' }),
    /WORKER_APPLICATION_RETRY_MAX_DELAY_MS must be a positive integer/
  );
  assert.throws(
    () => getApplicationRetryBackoffConfig({
      WORKER_APPLICATION_RETRY_BASE_DELAY_MS: '1000',
      WORKER_APPLICATION_RETRY_MAX_DELAY_MS: '999'
    }),
    /WORKER_APPLICATION_RETRY_MAX_DELAY_MS must be greater than or equal/
  );
});
