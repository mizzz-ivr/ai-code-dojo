import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  planSqliteMigrations,
  runSqliteMigrations
} from './migrations/sqlite-migration-runner.mjs';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const LEGACY_CHALLENGES_PATH = path.resolve(process.cwd(), 'apps/api/data/challenges-admin.json');
const LEGACY_SUBMISSIONS_PATH = path.join(DATA_DIR, 'submissions.json');
const SQLITE_BUSY_TIMEOUT_MS = 5000;

let db;

const ensureDataDir = () => {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
};

const createDatabaseConnection = (databasePath) => {
  const database = new DatabaseSync(databasePath);
  database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  return database;
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

const openDatabase = () => {
  ensureDataDir();
  return createDatabaseConnection(DB_PATH);
};

export const getDb = () => {
  if (db) return db;

  const database = openDatabase();
  try {
    runSqliteMigrations({ database });
    migrateLegacyJsonIfNeeded(database);
    db = database;
    return db;
  } catch (error) {
    database.close();
    throw error;
  }
};

export const runMigrations = () => {
  const database = getDb();
  runSqliteMigrations({ database });
  return DB_PATH;
};

export const planMigrations = () => {
  const database = createDatabaseConnection(existsSync(DB_PATH) ? DB_PATH : ':memory:');
  try {
    return planSqliteMigrations({ database });
  } finally {
    database.close();
  }
};

export const getDbPath = () => DB_PATH;
