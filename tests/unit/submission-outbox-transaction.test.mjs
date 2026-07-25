import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSubmissionWithQueueOutbox } from '../../apps/api/src/repositories/submission-outbox-repository.mjs';

const createDatabase = () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY,
      challenge_slug TEXT NOT NULL,
      language TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      result_json TEXT,
      grading_attempt INTEGER NOT NULL DEFAULT 1,
      attempt_idempotency_key TEXT
    );

    CREATE TABLE queue_outbox (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      grading_attempt INTEGER NOT NULL,
      message_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      publish_attempts INTEGER NOT NULL DEFAULT 0,
      last_attempted_at TEXT,
      last_error_type TEXT,
      UNIQUE(submission_id, grading_attempt)
    );
  `);
  return database;
};

test('submissionとqueue outboxを同一transactionで作成する', async () => {
  const database = createDatabase();
  const timestamp = '2026-07-25T00:00:00.000Z';

  const submission = await createSubmissionWithQueueOutbox({
    challengeSlug: 'js-bugfix-add',
    language: 'javascript',
    code: 'export const sum = (values) => values.reduce((a, b) => a + b, 0);'
  }, {
    database,
    now: () => timestamp,
    createId: () => 'submission-outbox-success'
  });

  assert.equal(submission.id, 'submission-outbox-success');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM submissions').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM queue_outbox').get().count, 1);

  const row = database.prepare('SELECT * FROM queue_outbox').get();
  const message = JSON.parse(row.message_json);
  assert.equal(row.status, 'pending');
  assert.equal(row.submission_id, submission.id);
  assert.equal(row.grading_attempt, 1);
  assert.equal(message.submissionId, submission.id);
  assert.equal(message.gradingAttempt, 1);
  assert.equal(message.attemptIdempotencyKey, 'submission-outbox-success:attempt:1');
  assert.equal(JSON.stringify(message).includes('export const sum'), false);
  assert.equal(JSON.stringify(message).includes('hiddenTests'), false);

  database.close();
});

test('outbox insert失敗時はsubmissionもrollbackする', async () => {
  const database = createDatabase();

  await assert.rejects(
    () => createSubmissionWithQueueOutbox({
      challengeSlug: 'js-bugfix-add',
      language: 'javascript',
      code: 'export const sum = () => 0;'
    }, {
      database,
      now: () => '2026-07-25T00:00:00.000Z',
      createId: () => 'submission-outbox-rollback',
      insertOutbox: async () => {
        throw new Error('simulated outbox insert failure');
      }
    }),
    /simulated outbox insert failure/
  );

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM submissions').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM queue_outbox').get().count, 0);

  database.close();
});
