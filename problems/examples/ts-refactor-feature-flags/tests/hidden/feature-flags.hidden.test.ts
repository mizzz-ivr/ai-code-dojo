import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFeatureFlags } from '../../starter/feature-flags.ts';

test('undefined overrideは下位階層の値を消さない', () => {
  const defaults = { newDashboard: true, betaSearch: false, aiReview: true };
  assert.deepEqual(
    resolveFeatureFlags(defaults, { newDashboard: undefined, betaSearch: true }, { betaSearch: undefined }),
    { newDashboard: true, betaSearch: true, aiReview: true }
  );
});

test('入力objectを変更しない', () => {
  const defaults = { newDashboard: false, betaSearch: false, aiReview: false };
  const account = { newDashboard: true };
  const user = { aiReview: true };
  const before = structuredClone({ defaults, account, user });

  resolveFeatureFlags(defaults, account, user);

  assert.deepEqual({ defaults, account, user }, before);
});
