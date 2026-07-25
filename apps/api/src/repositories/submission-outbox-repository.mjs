import crypto from 'node:crypto';
import { buildSubmissionQueueMessage } from '../../../../packages/queue/src/message-contract.mjs';
import { getDb } from '../db/database.mjs';
import { createAttemptIdempotencyKey } from './submission-repository.mjs';
import { insertQueueOutboxRecord } from './queue-outbox-repository.mjs';

const defaultNow = () => new Date().toISOString();

export const createSubmissionWithQueueOutbox = async (
  input,
  {
    database = getDb(),
    now = defaultNow,
    createId = () => crypto.randomUUID(),
    insertOutbox = insertQueueOutboxRecord
  } = {}
) => {
  const timestamp = now();
  const submission = {
    id: createId(),
    challengeSlug: input.challengeSlug,
    language: input.language,
    code: input.code,
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    result: null,
    gradingAttempt: 1,
    processingClaimedAt: null,
    processingHeartbeatAt: null,
    processingLeaseExpiresAt: null
  };

  submission.attemptIdempotencyKey = createAttemptIdempotencyKey(
    submission.id,
    submission.gradingAttempt
  );

  const message = buildSubmissionQueueMessage({
    submissionId: submission.id,
    gradingAttempt: submission.gradingAttempt,
    attemptIdempotencyKey: submission.attemptIdempotencyKey
  });

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`
      INSERT INTO submissions (
        id,
        challenge_slug,
        language,
        code,
        status,
        created_at,
        updated_at,
        result_json,
        grading_attempt,
        attempt_idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      submission.id,
      submission.challengeSlug,
      submission.language,
      submission.code,
      submission.status,
      submission.createdAt,
      submission.updatedAt,
      null,
      submission.gradingAttempt,
      submission.attemptIdempotencyKey
    );

    insertOutbox({
      database,
      message,
      timestamp
    });

    database.exec('COMMIT');
    return submission;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // rollback failure must not hide the original transaction error
    }
    throw error;
  }
};
