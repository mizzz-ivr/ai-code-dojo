import assert from 'node:assert/strict';
import test from 'node:test';

const createPayload = (slug = 'admin-contract') => ({
  slug,
  versionData: {
    metadata: { title: 'Admin Contract' },
    statement: { markdown: 'Fix the implementation.' },
    starterCode: [{ path: 'index.js', content: 'export const value = 0;' }],
    visibleTests: ['visible-contract-test'],
    hiddenTests: ['hidden-contract-test'],
    runnerConfig: { testCommand: 'npm test' },
    reviewConfig: {
      prTitleTemplate: 'title',
      prBodyTemplate: 'body',
      reviewerCommentTemplates: ['comment'],
      language: 'ja',
      focusPoints: ['correctness']
    }
  }
});

export const registerAdminChallengeRepositoryContract = ({
  name,
  createHarness
}) => {
  if (typeof createHarness !== 'function') {
    throw new TypeError('createHarness must be a function.');
  }

  const withHarness = async (operation) => {
    const harness = await createHarness();
    try {
      return await operation(harness);
    } finally {
      await harness.close();
    }
  };

  test(`${name}: Challenge作成・Version追加・公開状態を保持する`, async () => {
    await withHarness(async ({ repository }) => {
      assert.deepEqual(await repository.listAdminChallenges(), []);

      const payload = createPayload();
      const created = await repository.createAdminChallenge(payload);
      assert.ok(created.challengeId);
      assert.ok(created.versionId);

      const initial = await repository.getAdminChallengeById(created.challengeId);
      assert.equal(initial.slug, payload.slug);
      assert.equal(initial.status, 'draft');
      assert.equal(initial.currentVersionId, created.versionId);
      assert.deepEqual(initial.versions.map(({ version }) => version), [1]);
      assert.deepEqual(initial.versions[0].hiddenTests, ['hidden-contract-test']);

      const nextData = {
        ...payload.versionData,
        metadata: { title: 'Admin Contract v2' },
        hiddenTests: ['hidden-contract-test-v2']
      };
      const versionId = await repository.createAdminChallengeVersion(
        created.challengeId,
        nextData
      );
      assert.ok(versionId);

      const updated = await repository.getAdminChallengeById(created.challengeId);
      assert.equal(updated.currentVersionId, versionId);
      assert.deepEqual(updated.versions.map(({ version }) => version), [2, 1]);
      assert.equal(updated.versions[0].metadata.title, 'Admin Contract v2');
      assert.equal(updated.versions[1].metadata.title, 'Admin Contract');

      const published = await repository.setChallengePublishStatus(
        created.challengeId,
        'published'
      );
      assert.equal(published.status, 'published');

      const lookup = await repository.findPublishedChallengeBySlug(payload.slug);
      assert.equal(lookup.challenge.id, created.challengeId);
      assert.equal(lookup.version.id, versionId);
      assert.deepEqual(lookup.version.hiddenTests, ['hidden-contract-test-v2']);

      const draft = await repository.setChallengePublishStatus(
        created.challengeId,
        'draft'
      );
      assert.equal(draft.status, 'draft');
      assert.equal(await repository.findPublishedChallengeBySlug(payload.slug), null);
    });
  });

  test(`${name}: duplicate slugと存在しないChallengeを既存契約どおり扱う`, async () => {
    await withHarness(async ({ repository }) => {
      const payload = createPayload('duplicate-contract');
      const created = await repository.createAdminChallenge(payload);

      await assert.rejects(
        repository.createAdminChallenge(payload),
        /slug already exists/
      );
      assert.equal(await repository.getAdminChallengeById('missing-challenge'), null);
      assert.equal(
        await repository.createAdminChallengeVersion('missing-challenge', payload.versionData),
        null
      );
      assert.equal(
        await repository.setChallengePublishStatus('missing-challenge', 'published'),
        null
      );
      assert.equal(await repository.findPublishedChallengeBySlug('missing-slug'), null);

      const rows = await repository.listAdminChallenges();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, created.challengeId);
    });
  });

  test(`${name}: Challenge作成失敗時にChallenge rowとVersionをrollbackする`, async () => {
    await withHarness(async ({ repository }) => {
      const circular = {};
      circular.self = circular;

      await assert.rejects(
        repository.createAdminChallenge({
          slug: 'rollback-contract',
          versionData: circular
        }),
        TypeError
      );

      assert.deepEqual(await repository.listAdminChallenges(), []);
    });
  });
};
