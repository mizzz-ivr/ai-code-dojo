export const migrationManifest = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'core_schema',
    providers: Object.freeze({
      sqlite: Object.freeze({
        steps: Object.freeze([
          Object.freeze({
            type: 'sql',
            sql: `
              CREATE TABLE IF NOT EXISTS challenges (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                current_version_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
              );

              CREATE TABLE IF NOT EXISTS challenge_versions (
                id TEXT PRIMARY KEY,
                challenge_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                UNIQUE(challenge_id, version),
                FOREIGN KEY(challenge_id) REFERENCES challenges(id)
              );

              CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY,
                challenge_slug TEXT NOT NULL,
                language TEXT NOT NULL,
                code TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                result_json TEXT
              );

              CREATE INDEX IF NOT EXISTS idx_challenges_slug_status
                ON challenges(slug, status);
            `
          })
        ])
      }),
      postgresql: Object.freeze({
        steps: Object.freeze([
          Object.freeze({
            type: 'sql',
            sql: `
              CREATE TABLE IF NOT EXISTS challenges (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                current_version_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
              );

              CREATE TABLE IF NOT EXISTS challenge_versions (
                id TEXT PRIMARY KEY,
                challenge_id TEXT NOT NULL REFERENCES challenges(id),
                version INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                UNIQUE(challenge_id, version)
              );

              CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY,
                challenge_slug TEXT NOT NULL,
                language TEXT NOT NULL,
                code TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                result_json TEXT
              );

              CREATE INDEX IF NOT EXISTS idx_challenges_slug_status
                ON challenges(slug, status);
            `
          })
        ])
      })
    })
  }),
  Object.freeze({
    version: 2,
    name: 'submission_attempt_and_lease',
    providers: Object.freeze({
      sqlite: Object.freeze({
        steps: Object.freeze([
          Object.freeze({ type: 'addColumnIfMissing', table: 'submissions', column: 'grading_attempt', definition: 'INTEGER NOT NULL DEFAULT 1' }),
          Object.freeze({ type: 'addColumnIfMissing', table: 'submissions', column: 'attempt_idempotency_key', definition: 'TEXT' }),
          Object.freeze({ type: 'addColumnIfMissing', table: 'submissions', column: 'completion_guard_at', definition: 'TEXT' }),
          Object.freeze({ type: 'addColumnIfMissing', table: 'submissions', column: 'processing_claimed_at', definition: 'TEXT' }),
          Object.freeze({ type: 'addColumnIfMissing', table: 'submissions', column: 'processing_heartbeat_at', definition: 'TEXT' }),
          Object.freeze({ type: 'addColumnIfMissing', table: 'submissions', column: 'processing_lease_expires_at', definition: 'TEXT' }),
          Object.freeze({
            type: 'sql',
            sql: `
              CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_attempt_unique
                ON submissions(id, grading_attempt);
              CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_attempt_key_unique
                ON submissions(attempt_idempotency_key);
            `
          })
        ])
      }),
      postgresql: Object.freeze({
        steps: Object.freeze([
          Object.freeze({
            type: 'sql',
            sql: `
              ALTER TABLE submissions
                ADD COLUMN IF NOT EXISTS grading_attempt INTEGER NOT NULL DEFAULT 1;
              ALTER TABLE submissions
                ADD COLUMN IF NOT EXISTS attempt_idempotency_key TEXT;
              ALTER TABLE submissions
                ADD COLUMN IF NOT EXISTS completion_guard_at TEXT;
              ALTER TABLE submissions
                ADD COLUMN IF NOT EXISTS processing_claimed_at TEXT;
              ALTER TABLE submissions
                ADD COLUMN IF NOT EXISTS processing_heartbeat_at TEXT;
              ALTER TABLE submissions
                ADD COLUMN IF NOT EXISTS processing_lease_expires_at TEXT;

              CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_attempt_unique
                ON submissions(id, grading_attempt);
              CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_attempt_key_unique
                ON submissions(attempt_idempotency_key);
            `
          })
        ])
      })
    })
  }),
  Object.freeze({
    version: 3,
    name: 'queue_outbox',
    providers: Object.freeze({
      sqlite: Object.freeze({
        steps: Object.freeze([
          Object.freeze({
            type: 'sql',
            sql: `
              CREATE TABLE IF NOT EXISTS queue_outbox (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL,
                grading_attempt INTEGER NOT NULL,
                message_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                published_at TEXT,
                publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
                last_attempted_at TEXT,
                last_error_type TEXT,
                UNIQUE(submission_id, grading_attempt),
                FOREIGN KEY(submission_id) REFERENCES submissions(id)
              );

              CREATE INDEX IF NOT EXISTS idx_queue_outbox_pending
                ON queue_outbox(status, created_at);
            `
          })
        ])
      }),
      postgresql: Object.freeze({
        steps: Object.freeze([
          Object.freeze({
            type: 'sql',
            sql: `
              CREATE TABLE IF NOT EXISTS queue_outbox (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL REFERENCES submissions(id),
                grading_attempt INTEGER NOT NULL,
                message_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                published_at TEXT,
                publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
                last_attempted_at TEXT,
                last_error_type TEXT,
                UNIQUE(submission_id, grading_attempt)
              );

              CREATE INDEX IF NOT EXISTS idx_queue_outbox_pending
                ON queue_outbox(status, created_at);
            `
          })
        ])
      })
    })
  })
]);
