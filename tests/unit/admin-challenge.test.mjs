import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createAdminChallengeRepository,
  createAdminChallenge,
  createAdminChallengeVersion,
  getAdminChallengeById,
  setChallengePublishStatus
} from '../../apps/api/src/repositories/admin-challenge-repository.mjs';
import { createSqliteDatabaseClient } from '../../apps/api/src/db/adapters/sqlite-database-client.mjs';
import { runSqliteMigrations } from '../../apps/api/src/db/migrations/sqlite-migration-runner.mjs';
import { registerAdminChallengeRepositoryContract } from './helpers/admin-challenge-repository-contract.mjs';

const basePayload = {
  slug: 'admin-test',
  versionData: {
    metadata: { title: 'Admin Test' },
    statement: {},
    starterCode: [],
    visibleTests: ['a'],
    hiddenTests: ['b'],
    runnerConfig: { testCommand: 'npm test' },
    reviewConfig: {
      prTitleTemplate: 't',
      prBodyTemplate: 'b',
      reviewerCommentTemplates: ['c'],
      language: 'ja',
      focusPoints: ['x']
    }
  }
};

registerAdminChallengeRepositoryContract({
  name: 'SQLite Admin Challenge Repository',
  createHarness: async () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    runSqliteMigrations({ database });
    const databaseClient = createSqliteDatabaseClient({ database });
    const repository = createAdminChallengeRepository({ databaseClient });

    return Object.freeze({
      repository,
      close: () => databaseClient.close()
    });
  }
});

test('既存exportは現行SQLite runtimeとの互換性を維持する', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dojo-'));
  const previousDirectory = process.cwd();

  try {
    process.chdir(dir);
    const created = await createAdminChallenge(basePayload);
    const versionId = await createAdminChallengeVersion(
      created.challengeId,
      basePayload.versionData
    );
    assert.ok(versionId);

    const detail = await getAdminChallengeById(created.challengeId);
    assert.equal(detail.versions.length, 2);

    const published = await setChallengePublishStatus(created.challengeId, 'published');
    assert.equal(published.status, 'published');
    const draft = await setChallengePublishStatus(created.challengeId, 'draft');
    assert.equal(draft.status, 'draft');
  } finally {
    process.chdir(previousDirectory);
    await rm(dir, { recursive: true, force: true });
  }
});
