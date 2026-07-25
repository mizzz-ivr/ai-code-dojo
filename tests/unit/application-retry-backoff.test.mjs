import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationRetryBackoff } from '../../apps/worker/src/services/application-retry-backoff.mjs';

test('backoff無効時はretry ordinalを維持して0msを返す', async () => {
  const sleeps = [];
  const backoff = createApplicationRetryBackoff({
    config: { enabled: false, baseDelayMs: 5000, maxDelayMs: 60000 },
    random: () => {
      throw new Error('disabled時はrandomを呼ばない');
    },
    sleep: async (delayMs) => sleeps.push(delayMs)
  });

  assert.deepEqual(backoff.calculate({ nextAttempt: 2 }), {
    backoffEnabled: false,
    retryOrdinal: 0,
    delayMs: 0,
    capDelayMs: 0
  });
  await backoff.wait(0);
  assert.deepEqual(sleeps, []);
});

test('exponential capとfull jitterを決定的に計算できる', () => {
  const backoff = createApplicationRetryBackoff({
    config: { enabled: true, baseDelayMs: 1000, maxDelayMs: 5000 },
    random: () => 0.5
  });

  assert.deepEqual(backoff.calculate({ nextAttempt: 2 }), {
    backoffEnabled: true,
    retryOrdinal: 0,
    delayMs: 500,
    capDelayMs: 1000
  });
  assert.deepEqual(backoff.calculate({ nextAttempt: 3 }), {
    backoffEnabled: true,
    retryOrdinal: 1,
    delayMs: 1000,
    capDelayMs: 2000
  });
  assert.deepEqual(backoff.calculate({ nextAttempt: 5 }), {
    backoffEnabled: true,
    retryOrdinal: 3,
    delayMs: 2500,
    capDelayMs: 5000
  });
});

test('waitは算出済みdelayだけをinjectしたsleepへ渡す', async () => {
  const sleeps = [];
  const backoff = createApplicationRetryBackoff({
    config: { enabled: true, baseDelayMs: 100, maxDelayMs: 1000 },
    sleep: async (delayMs) => sleeps.push(delayMs)
  });

  await backoff.wait(250);
  assert.deepEqual(sleeps, [250]);
});

test('不正なattempt・random・delayを拒否する', async () => {
  const invalidRandomBackoff = createApplicationRetryBackoff({
    config: { enabled: true, baseDelayMs: 100, maxDelayMs: 1000 },
    random: () => 1
  });

  assert.throws(() => invalidRandomBackoff.calculate({ nextAttempt: 1 }), /nextAttempt/);
  assert.throws(() => invalidRandomBackoff.calculate({ nextAttempt: 2 }), /random/);
  await assert.rejects(() => invalidRandomBackoff.wait(-1), /delayMs/);
});
