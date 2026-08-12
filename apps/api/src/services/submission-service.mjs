import { enqueueSubmissionAttempt } from '../../../../packages/queue/src/submission-queue.mjs';
import { canSubmitChallengeLanguage } from '../../../../packages/runner-sdk/src/language-policy.mjs';
import { loadQueueOutboxConfig } from '../config/queue-outbox-config.mjs';
import { getChallengeBySlug } from '../repositories/challenge-repository.mjs';
import { createSubmission, getSubmission } from '../repositories/submission-repository.mjs';
import { createSubmissionWithQueueOutbox } from '../repositories/submission-outbox-repository.mjs';
import { dispatchQueueOutboxBatch } from './queue-outbox-dispatcher.mjs';

export { enqueueSubmissionAttempt };

const CHALLENGE_SLUG_PATTERN = /^[a-z0-9-]+$/;

export const validateSubmissionInput = (input) => {
  if (!input || typeof input !== 'object') return false;
  if (
    typeof input.challengeSlug !== 'string'
    || input.challengeSlug.length === 0
    || !CHALLENGE_SLUG_PATTERN.test(input.challengeSlug)
  ) return false;
  if (typeof input.language !== 'string' || input.language.length === 0) return false;
  if (typeof input.code !== 'string' || input.code.length === 0) return false;
  return true;
};

export const validateSubmissionTarget = async (
  input,
  { getChallenge = getChallengeBySlug } = {}
) => {
  let challenge;
  try {
    challenge = await getChallenge(input.challengeSlug);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        error: 'challengeが見つかりません。',
        statusCode: 404
      };
    }
    throw error;
  }

  if (challenge?.metadata?.slug !== input.challengeSlug) {
    return {
      error: 'challenge定義が不整合です。',
      statusCode: 409
    };
  }

  if (!canSubmitChallengeLanguage(challenge, input.language)) {
    return {
      error: 'このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。',
      statusCode: 400
    };
  }

  return null;
};

export const createSubmissionAndEnqueue = async (
  body,
  {
    outboxConfig = loadQueueOutboxConfig(),
    getChallenge = getChallengeBySlug,
    createWithOutbox = createSubmissionWithQueueOutbox,
    dispatchOutbox = dispatchQueueOutboxBatch,
    createLegacySubmission = createSubmission,
    enqueueLegacy = enqueueSubmissionAttempt
  } = {}
) => {
  if (!validateSubmissionInput(body)) {
    return { error: '不正なsubmission入力です。challengeSlug/language/codeを確認してください。', statusCode: 400 };
  }

  const targetError = await validateSubmissionTarget(body, { getChallenge });
  if (targetError) return targetError;

  if (outboxConfig.enabled) {
    const submission = await createWithOutbox(body);

    try {
      await dispatchOutbox({
        limit: outboxConfig.batchSize,
        trigger: 'submission'
      });
    } catch {
      // The atomic outbox row remains pending and the periodic dispatcher retries it.
    }

    return { data: { id: submission.id, status: submission.status }, statusCode: 201 };
  }

  const submission = await createLegacySubmission(body);
  const enqueued = await enqueueLegacy({
    submissionId: submission.id,
    gradingAttempt: submission.gradingAttempt,
    attemptIdempotencyKey: submission.attemptIdempotencyKey
  });

  if (!enqueued) {
    return { error: 'Workerへのジョブ投入に失敗しました。', statusCode: 502 };
  }

  return { data: { id: submission.id, status: submission.status }, statusCode: 201 };
};

export const getSubmissionResult = async (id, auth = { role: 'guest' }) => {
  const submission = await getSubmission(id);
  if (!submission) {
    return { error: 'submissionが見つかりません。', statusCode: 404 };
  }

  const visibleTests = (submission.result?.testResults ?? []).filter((test) => test.visibility === 'visible');
  const hiddenSummary = (submission.result?.testResults ?? []).filter((test) => test.visibility === 'hidden');
  const isAdmin = auth.role === 'admin';
  const learnerSafeStatus = submission.status === 'retry_pending'
    ? 'retrying'
    : submission.status === 'infra_failed'
      ? 'failed'
      : submission.status;
  const learnerSafeResultStatus = submission.result?.status === 'infra_failed'
    ? 'failed'
    : submission.result?.status;

  return {
    statusCode: 200,
    data: {
      id: submission.id,
      challengeSlug: submission.challengeSlug,
      language: submission.language,
      status: isAdmin ? submission.status : learnerSafeStatus,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      result: submission.result
        ? {
            status: isAdmin ? submission.result.status : learnerSafeResultStatus,
            score: submission.result.score,
            logs: isAdmin ? submission.result.logs : undefined,
            internal: isAdmin ? {
              hiddenTestResults: (submission.result?.testResults ?? []).filter((test) => test.visibility === 'hidden'),
              fullTestResults: submission.result?.testResults ?? []
            } : undefined,
            durationMs: submission.result.durationMs,
            visibleTests,
            hiddenTests: {
              passed: hiddenSummary.every((test) => test.passed),
              total: hiddenSummary.length,
              passedCount: hiddenSummary.filter((test) => test.passed).length
            }
          }
        : null
    }
  };
};
