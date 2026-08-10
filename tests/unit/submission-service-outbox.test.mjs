import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSubmissionAndEnqueue,
  validateSubmissionInput,
  validateSubmissionTarget
} from '../../apps/api/src/services/submission-service.mjs';

const validInput = {
  challengeSlug: 'js-bugfix-add',
  language: 'javascript',
  code: 'export const sum = () => 0;'
};

const runnableChallenge = {
  metadata: {
    slug: 'js-bugfix-add',
    supportedLanguages: ['javascript']
  }
};

const getRunnableChallenge = async () => runnableChallenge;

test('outbox有効時はatomic保存後のpublish失敗でも201で受理する', async () => {
  const calls = [];
  const result = await createSubmissionAndEnqueue(validInput, {
    outboxConfig: { enabled: true, batchSize: 10, pollIntervalMs: 1000 },
    getChallenge: getRunnableChallenge,
    createWithOutbox: async (body) => {
      calls.push(['createWithOutbox', body.challengeSlug]);
      return { id: 'submission-outbox', status: 'queued' };
    },
    dispatchOutbox: async ({ trigger, limit }) => {
      calls.push(['dispatchOutbox', trigger, limit]);
      throw new Error('simulated publish failure');
    },
    createLegacySubmission: async () => assert.fail('legacy create must not be called'),
    enqueueLegacy: async () => assert.fail('legacy enqueue must not be called')
  });

  assert.deepEqual(result, {
    data: { id: 'submission-outbox', status: 'queued' },
    statusCode: 201
  });
  assert.deepEqual(calls, [
    ['createWithOutbox', 'js-bugfix-add'],
    ['dispatchOutbox', 'submission', 10]
  ]);
});

test('outbox無効時は既存のenqueue失敗502を維持する', async () => {
  const result = await createSubmissionAndEnqueue(validInput, {
    outboxConfig: { enabled: false, batchSize: 25, pollIntervalMs: 1000 },
    getChallenge: getRunnableChallenge,
    createLegacySubmission: async () => ({
      id: 'submission-legacy',
      status: 'queued',
      gradingAttempt: 1,
      attemptIdempotencyKey: 'submission-legacy:attempt:1'
    }),
    enqueueLegacy: async () => false,
    createWithOutbox: async () => assert.fail('outbox create must not be called'),
    dispatchOutbox: async () => assert.fail('outbox dispatch must not be called')
  });

  assert.deepEqual(result, {
    error: 'Workerへのジョブ投入に失敗しました。',
    statusCode: 502
  });
});

test('challengeSlugはProblem schemaと同じ安全な文字種だけを許可する', () => {
  assert.equal(validateSubmissionInput(validInput), true);
  assert.equal(validateSubmissionInput({ ...validInput, challengeSlug: '../../secret' }), false);
  assert.equal(validateSubmissionInput({ ...validInput, challengeSlug: 'challenge/name' }), false);
  assert.equal(validateSubmissionInput({ ...validInput, challengeSlug: 'Challenge' }), false);
});

test('存在しないChallengeは永続化前に404で拒否する', async () => {
  const error = new Error('not found');
  error.code = 'ENOENT';

  const result = await createSubmissionAndEnqueue(validInput, {
    getChallenge: async () => { throw error; },
    createWithOutbox: async () => assert.fail('invalid submission must not be persisted'),
    createLegacySubmission: async () => assert.fail('invalid submission must not be persisted')
  });

  assert.deepEqual(result, {
    error: 'challengeが見つかりません。',
    statusCode: 404
  });
});

test('Challengeが対応しないlanguageへの偽装を永続化前に拒否する', async () => {
  const result = await createSubmissionAndEnqueue(
    { ...validInput, language: 'typescript' },
    {
      getChallenge: getRunnableChallenge,
      createWithOutbox: async () => assert.fail('invalid submission must not be persisted'),
      createLegacySubmission: async () => assert.fail('invalid submission must not be persisted')
    }
  );

  assert.deepEqual(result, {
    error: 'このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。',
    statusCode: 400
  });
});

test('SQL Challengeはlanguage偽装を含め現行Runnerへ投入しない', async () => {
  const sqlChallenge = {
    metadata: {
      slug: 'sql-monthly-sales',
      supportedLanguages: ['sql']
    }
  };

  const sqlResult = await validateSubmissionTarget(
    { challengeSlug: 'sql-monthly-sales', language: 'sql', code: 'SELECT 1;' },
    { getChallenge: async () => sqlChallenge }
  );
  assert.deepEqual(sqlResult, {
    error: 'このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。',
    statusCode: 400
  });

  const spoofedResult = await validateSubmissionTarget(
    { challengeSlug: 'sql-monthly-sales', language: 'javascript', code: 'SELECT 1;' },
    { getChallenge: async () => sqlChallenge }
  );
  assert.deepEqual(spoofedResult, {
    error: 'このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。',
    statusCode: 400
  });
});

test('Challenge定義のslug不整合はfail-closedで拒否する', async () => {
  const result = await validateSubmissionTarget(validInput, {
    getChallenge: async () => ({
      metadata: {
        slug: 'different-slug',
        supportedLanguages: ['javascript']
      }
    })
  });

  assert.deepEqual(result, {
    error: 'challenge定義が不整合です。',
    statusCode: 409
  });
});
