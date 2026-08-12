import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccessLevel } from '../../starter/access-policy.ts';

test('adminはfull accessになる', () => {
  assert.equal(getAccessLevel({ roles: ['admin'], suspended: false }), 'full');
});

test('viewerはread accessになる', () => {
  assert.equal(getAccessLevel({ roles: ['viewer'], suspended: false }), 'read');
});
