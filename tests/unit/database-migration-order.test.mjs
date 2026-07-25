import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const resetDbModule = async () => {
  const moduleUrl = new URL('../../apps/api/src/db/database.mjs', import.meta.url);
  return import(`${moduleUrl.href}?t=${Date.now()}`);
};

test('runMigrations adds attempt, lease, and queue outbox schema idempotently', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dojo-db-migrate-'));
  const prev = process.cwd();
  process.chdir(dir);

  const dataDir = path.join(dir, '.data');
  await mkdir(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  const legacyDb = new DatabaseSync(dbPath);

  legacyDb.exec(`
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY,
      challenge_slug TEXT NOT NULL,
      language TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      result_json TEXT
    );
  `);
  legacyDb.close();

  const { runMigrations } = await resetDbModule();
  runMigrations();
  runMigrations();

  const migratedDb = new DatabaseSync(dbPath);
  const columns = migratedDb.prepare('PRAGMA table_info(submissions)').all();
  const indexes = migratedDb.prepare('PRAGMA index_list(submissions)').all();
  const columnNames = new Set(columns.map((column) => column.name));

  assert.ok(columnNames.has('grading_attempt'));
  assert.ok(columnNames.has('attempt_idempotency_key'));
  assert.ok(columnNames.has('completion_guard_at'));
  assert.ok(columnNames.has('processing_claimed_at'));
  assert.ok(columnNames.has('processing_heartbeat_at'));
  assert.ok(columnNames.has('processing_lease_expires_at'));
  assert.ok(indexes.some((index) => index.name === 'idx_submissions_attempt_unique'));
  assert.ok(indexes.some((index) => index.name === 'idx_submissions_attempt_key_unique'));

  const outboxColumns = migratedDb.prepare('PRAGMA table_info(queue_outbox)').all();
  const outboxIndexes = migratedDb.prepare('PRAGMA index_list(queue_outbox)').all();
  const outboxColumnNames = new Set(outboxColumns.map((column) => column.name));

  assert.ok(outboxColumnNames.has('submission_id'));
  assert.ok(outboxColumnNames.has('grading_attempt'));
  assert.ok(outboxColumnNames.has('message_json'));
  assert.ok(outboxColumnNames.has('status'));
  assert.ok(outboxColumnNames.has('publish_attempts'));
  assert.ok(outboxColumnNames.has('last_attempted_at'));
  assert.ok(outboxColumnNames.has('last_error_type'));
  assert.ok(outboxIndexes.some((index) => index.name === 'idx_queue_outbox_pending'));

  const keyRows = migratedDb.prepare('SELECT attempt_idempotency_key FROM submissions').all();
  const outboxRows = migratedDb.prepare('SELECT id FROM queue_outbox').all();
  assert.deepEqual(keyRows, []);
  assert.deepEqual(outboxRows, []);

  migratedDb.close();
  process.chdir(prev);
  await rm(dir, { recursive: true, force: true });
});
