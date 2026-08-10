import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccessLevel } from '../../starter/access-policy.ts';

test('suspendedはadminでもblockedになる', () => {
  assert.equal(getAccessLevel({ roles: ['admin'], suspended: true }), 'blocked');
});

test('editorはwrite accessになる', () => {
  assert.equal(getAccessLevel({ roles: ['viewer', 'editor'], suspended: false }), 'write');
});

test('複数roleではadminを優先する', () => {
  assert.equal(getAccessLevel({ roles: ['viewer', 'editor', 'admin'], suspended: false }), 'full');
});

test('roleなしはread accessになる', () => {
  assert.equal(getAccessLevel({ roles: [], suspended: false }), 'read');
});
