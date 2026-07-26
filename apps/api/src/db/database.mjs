import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const LEGACY_CHALLENGES_PATH = path.resolve(process.cwd(), 'apps/api/data/challenges-admin.json');
const LEGACY_SUBMISSIONS_PATH = path.join(DATA_DIR, 'submissions.json');

let db;

const ensureDataDir = () => {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
};

const ensureSubmissionColumns = (database) => {
  const columns = database.prepare('PRAGMA table_info(submissions)').all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('grading_attempt')) {
    database.exec('ALTER TABLE submissions ADD COLUMN grading_attempt INTEGER NOT NULL DEFAULT 1');
  }

  if (!columnNames.has('attempt_idempotency_key')) {
    database.exec('ALTER TABLE submissions ADD COLUMN attempt_idempotency_key TEXT');
  }

  if (!columnNames.has('completion_guard_at')) {
    database.exec('ALTER TABLE submissions ADD COLUMN completion_guard_at TEXT');
  }

  if (!columnNames.has('processing_claimed_at')) {
    database.exec('ALTER TABLE submissions ADD COLUMN processing_claimed_at TEXT');
  }

  if (!columnNames.has('processing_heartbeat_at')) {
    database.exec('ALTER TABLE submissions ADD COLUMN processing_heartbeat_at TEXT');
  }

  if (!columnNames.has('processing_lease_expires_at')) {
    database.exec('ALTER TABLE submissions ADD COLUMN processing_lease_expires_at TEXT');
  }
};

const ensureSubmissionIndexes = (database) => {
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_attempt_unique ON submissions(id, grading_attempt);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_attempt_key_unique ON submissions(attempt_idempotency_key);
  `);
};

const migrateSchema = (database) => {
  database.exec(`
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
      result_json TEXT,
      grading_attempt INTEGER NOT NULL DEFAULT 1,
      attempt_idempotency_key TEXT,
      completion_guard_at TEXT,
      processing_claimed_at TEXT,
      processing_heartbeat_at TEXT,
      processing_lease_expires_at TEXT
    );

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

    CREATE INDEX IF NOT EXISTS idx_challenges_slug_status ON challenges(slug, status);
    CREATE INDEX IF NOT EXISTS idx_queue_outbox_pending ON queue_outbox(status, created_at);
  `);

  ensureSubmissionColumns(database);
  ensureSubmissionIndexes(database);
};

const migrateLegacyJsonIfNeeded = (database) => {
  const count = database.prepare('SELECT COUNT(*) AS count FROM challenges').get().count;
  if (count === 0 && existsSync(LEGACY_CHALLENGES_PATH)) {
    const raw = JSON.parse(readFileSync(LEGACY_CHALLENGES_PATH, 'utf8'));
    const insertChallenge = database.prepare('INSERT OR IGNORE INTO challenges (id, slug, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertVersion = database.prepare('INSERT OR IGNORE INTO challenge_versions (id, challenge_id, version, created_at, payload_json) VALUES (?, ?, ?, ?, ?)');
    for (const challenge of raw.challenges ?? []) {
      insertChallenge.run(challenge.id, challenge.slug, challenge.status, challenge.currentVersionId ?? null, challenge.createdAt, challenge.updatedAt);
    }
    for (const version of raw.challengeVersions ?? []) {
      const payload = {
        metadata: version.metadata,
        statement: version.statement,
        starterCode: version.starterCode,
        visibleTests: version.visibleTests,
        hiddenTests: version.hiddenTests,
        runnerConfig: version.runnerConfig,
        reviewConfig: version.reviewConfig
      };
      insertVersion.run(version.id, version.challengeId, version.version, version.createdAt, JSON.stringify(payload));
    }
  }

  const submissionCount = database.prepare('SELECT COUNT(*) AS count FROM submissions').get().count;
  if (submissionCount === 0 && existsSync(LEGACY_SUBMISSIONS_PATH)) {
    const raw = JSON.parse(readFileSync(LEGACY_SUBMISSIONS_PATH, 'utf8'));
    const insertSubmission = database.prepare('INSERT OR IGNORE INTO submissions (id, challenge_slug, language, code, status, created_at, updated_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const submission of raw) {
      insertSubmission.run(
        submission.id,
        submission.challengeSlug,
        submission.language,
        submission.code,
        submission.status,
        submission.createdAt,
        submission.updatedAt,
        submission.result ? JSON.stringify(submission.result) : null
      );
    }
  }
};

export const getDb = () => {
  if (db) return db;
  ensureDataDir();
  db = new DatabaseSync(DB_PATH);
  migrateSchema(db);
  migrateLegacyJsonIfNeeded(db);
  return db;
};

export const runMigrations = () => {
  const database = getDb();
  migrateSchema(database);
  return DB_PATH;
};

export const getDbPath = () => DB_PATH;
