import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFeatureFlags } from '../../starter/feature-flags.ts';

const defaults = { newDashboard: false, betaSearch: false, aiReview: false };

test('account overrideをdefaultsへ適用する', () => {
  assert.deepEqual(
    resolveFeatureFlags(defaults, { betaSearch: true }),
    { newDashboard: false, betaSearch: true, aiReview: false }
  );
});

test('user overrideをaccountより優先する', () => {
  assert.deepEqual(
    resolveFeatureFlags(defaults, { aiReview: true }, { aiReview: false }),
    { newDashboard: false, betaSearch: false, aiReview: false }
  );
});
