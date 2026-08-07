import { randomUUID } from 'node:crypto';
import { getRuntimeDatabaseClient } from '../db/runtime-database-client.mjs';

const defaultNow = () => new Date().toISOString();

const assertDatabaseClient = (databaseClient) => {
  if (
    !databaseClient ||
    typeof databaseClient.query !== 'function' ||
    typeof databaseClient.execute !== 'function' ||
    typeof databaseClient.transaction !== 'function'
  ) {
    throw new TypeError('databaseClient must provide query(), execute(), and transaction().');
  }
};

const mapChallengeRow = (row) => ({
  id: row.id,
  slug: row.slug,
  status: row.status,
  currentVersionId: row.current_version_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapVersionRow = (row) => ({
  id: row.id,
  challengeId: row.challenge_id,
  version: Number(row.version),
  createdAt: row.created_at,
  ...JSON.parse(row.payload_json)
});

const firstRow = (rows) => rows[0] ?? null;

export const createAdminChallengeRepository = ({
  databaseClient,
  createId = randomUUID,
  now = defaultNow
}) => {
  assertDatabaseClient(databaseClient);
  if (typeof createId !== 'function') throw new TypeError('createId must be a function.');
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  const listAdminChallenges = async () => {
    const rows = await databaseClient.query(
      'SELECT * FROM challenges ORDER BY updated_at DESC'
    );
    return rows.map(mapChallengeRow);
  };

  const getAdminChallengeByIdWithClient = async (client, id) => {
    const challengeRow = firstRow(await client.query(
      'SELECT * FROM challenges WHERE id = ?',
      [id]
    ));
    if (!challengeRow) return null;

    const versionRows = await client.query(
      'SELECT * FROM challenge_versions WHERE challenge_id = ? ORDER BY version DESC',
      [id]
    );
    return {
      ...mapChallengeRow(challengeRow),
      versions: versionRows.map(mapVersionRow)
    };
  };

  const getAdminChallengeById = async (id) =>
    getAdminChallengeByIdWithClient(databaseClient, id);

  const createAdminChallenge = async (payload) => databaseClient.transaction(async (transaction) => {
    const existing = firstRow(await transaction.query(
      'SELECT id FROM challenges WHERE slug = ?',
      [payload.slug]
    ));
    if (existing) throw new Error('slug already exists');

    const challengeId = createId();
    const versionId = createId();
    const createdAt = now();

    await transaction.execute(
      'INSERT INTO challenges (id, slug, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [challengeId, payload.slug, 'draft', versionId, createdAt, createdAt]
    );
    await transaction.execute(
      'INSERT INTO challenge_versions (id, challenge_id, version, created_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [versionId, challengeId, 1, createdAt, JSON.stringify(payload.versionData)]
    );

    return { challengeId, versionId };
  });

  const createAdminChallengeVersion = async (challengeId, versionData) =>
    databaseClient.transaction(async (transaction) => {
      const challenge = firstRow(await transaction.query(
        'SELECT id FROM challenges WHERE id = ?',
        [challengeId]
      ));
      if (!challenge) return null;

      const versionRow = firstRow(await transaction.query(
        'SELECT COALESCE(MAX(version), 0) AS version FROM challenge_versions WHERE challenge_id = ?',
        [challengeId]
      ));
      const version = Number(versionRow?.version ?? 0) + 1;
      const id = createId();
      const updatedAt = now();

      await transaction.execute(
        'INSERT INTO challenge_versions (id, challenge_id, version, created_at, payload_json) VALUES (?, ?, ?, ?, ?)',
        [id, challengeId, version, updatedAt, JSON.stringify(versionData)]
      );
      await transaction.execute(
        'UPDATE challenges SET current_version_id = ?, updated_at = ? WHERE id = ?',
        [id, updatedAt, challengeId]
      );

      return id;
    });

  const setChallengePublishStatus = async (challengeId, status) => {
    const updatedAt = now();
    const result = await databaseClient.execute(
      'UPDATE challenges SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, challengeId]
    );
    if (result.rowCount === 0) return null;

    const row = firstRow(await databaseClient.query(
      'SELECT * FROM challenges WHERE id = ?',
      [challengeId]
    ));
    return row ? mapChallengeRow(row) : null;
  };

  const findPublishedChallengeBySlug = async (slug) => {
    const challengeRow = firstRow(await databaseClient.query(
      "SELECT * FROM challenges WHERE slug = ? AND status = 'published'",
      [slug]
    ));
    if (!challengeRow) return null;

    const versionRow = firstRow(await databaseClient.query(
      'SELECT * FROM challenge_versions WHERE id = ?',
      [challengeRow.current_version_id]
    ));
    if (!versionRow) return null;

    return {
      challenge: mapChallengeRow(challengeRow),
      version: mapVersionRow(versionRow)
    };
  };

  return Object.freeze({
    listAdminChallenges,
    getAdminChallengeById,
    createAdminChallenge,
    createAdminChallengeVersion,
    setChallengePublishStatus,
    findPublishedChallengeBySlug
  });
};

let defaultRepository;
const getDefaultRepository = () => {
  if (!defaultRepository) {
    defaultRepository = createAdminChallengeRepository({
      databaseClient: getRuntimeDatabaseClient()
    });
  }
  return defaultRepository;
};

export const listAdminChallenges = (...args) =>
  getDefaultRepository().listAdminChallenges(...args);
export const getAdminChallengeById = (...args) =>
  getDefaultRepository().getAdminChallengeById(...args);
export const createAdminChallenge = (...args) =>
  getDefaultRepository().createAdminChallenge(...args);
export const createAdminChallengeVersion = (...args) =>
  getDefaultRepository().createAdminChallengeVersion(...args);
export const setChallengePublishStatus = (...args) =>
  getDefaultRepository().setChallengePublishStatus(...args);
export const findPublishedChallengeBySlug = (...args) =>
  getDefaultRepository().findPublishedChallengeBySlug(...args);
