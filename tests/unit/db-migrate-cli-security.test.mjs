import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('db:migrate失敗時にconnection URL・password・raw errorを出力しない', () => {
  const secret = 'super-secret-password';
  const result = spawnSync(process.execPath, ['scripts/db-migrate.mjs', '--plan'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PROVIDER: 'postgresql',
      POSTGRESQL_DATABASE_URL: `postgresql://dojo:${secret}@db.example.com:5432/dojo`,
      POSTGRESQL_SSL_MODE: 'invalid'
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.doesNotMatch(result.stderr, /db\.example\.com/);
  assert.doesNotMatch(result.stderr, /POSTGRESQL_DATABASE_URL/);
  assert.doesNotMatch(result.stderr, /stack|cause/i);

  const errorEvent = JSON.parse(result.stderr.trim());
  assert.deepEqual(errorEvent, {
    event: 'db.migration.failed',
    provider: 'postgresql',
    mode: 'plan',
    errorType: 'RangeError'
  });
});
