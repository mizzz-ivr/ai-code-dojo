import crypto from 'node:crypto';
import { getDb } from '../db/database.mjs';

const now = () => new Date().toISOString();

const parseMessage = (messageJson) => {
  try {
    return { message: JSON.parse(messageJson), messageErrorType: null };
  } catch (error) {
    return { message: null, messageErrorType: error?.name ?? 'SyntaxError' };
  }
};

const mapRow = (row) => {
  const parsed = parseMessage(row.message_json);
  return {
    id: row.id,
    submissionId: row.submission_id,
    gradingAttempt: row.grading_attempt,
    message: parsed.message,
    messageErrorType: parsed.messageErrorType,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? null,
    publishAttempts: row.publish_attempts ?? 0,
    lastAttemptedAt: row.last_attempted_at ?? null,
    lastErrorType: row.last_error_type ?? null
  };
};

const normalizeErrorType = (errorType) => {
  if (typeof errorType !== 'string' || errorType.length === 0) return 'QueuePublishError';
  return errorType.slice(0, 128);
};

export const insertQueueOutboxRecord = ({
  database = getDb(),
  message,
  timestamp = now(),
  id = crypto.randomUUID()
}) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('queue outbox message must be an object.');
  }

  database.prepare(`
    INSERT INTO queue_outbox (
      id,
      submission_id,
      grading_attempt,
      message_json,
      status,
      created_at,
      updated_at,
      published_at,
      publish_attempts,
      last_attempted_at,
      last_error_type
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, 0, NULL, NULL)
  `).run(
    id,
    message.submissionId,
    message.gradingAttempt,
    JSON.stringify(message),
    timestamp,
    timestamp
  );

  return getQueueOutboxById(id, { database });
};

export const getQueueOutboxById = async (id, { database = getDb() } = {}) => {
  const row = database.prepare('SELECT * FROM queue_outbox WHERE id = ?').get(id);
  return row ? mapRow(row) : null;
};

export const listPendingQueueOutbox = async ({ limit = 25, database = getDb() } = {}) => {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError('queue outbox limit must be a positive safe integer.');
  }

  const rows = database.prepare(`
    SELECT *
    FROM queue_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(limit);

  return rows.map(mapRow);
};

export const markQueueOutboxPublished = async (
  id,
  { database = getDb(), timestamp = now() } = {}
) => {
  const write = database.prepare(`
    UPDATE queue_outbox
    SET status = 'published',
        updated_at = ?,
        published_at = ?,
        publish_attempts = publish_attempts + 1,
        last_attempted_at = ?,
        last_error_type = NULL
    WHERE id = ?
      AND status = 'pending'
  `).run(timestamp, timestamp, timestamp, id);

  if (write.changes === 0) return null;
  return getQueueOutboxById(id, { database });
};

export const recordQueueOutboxPublishFailure = async (
  id,
  errorType,
  { database = getDb(), timestamp = now() } = {}
) => {
  const write = database.prepare(`
    UPDATE queue_outbox
    SET updated_at = ?,
        publish_attempts = publish_attempts + 1,
        last_attempted_at = ?,
        last_error_type = ?
    WHERE id = ?
      AND status = 'pending'
  `).run(timestamp, timestamp, normalizeErrorType(errorType), id);

  if (write.changes === 0) return null;
  return getQueueOutboxById(id, { database });
};
