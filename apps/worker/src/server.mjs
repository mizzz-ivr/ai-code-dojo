import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSubmissionQueueMessage } from '../../../packages/queue/src/message-contract.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from '../../../packages/queue/src/queue-event-logger.mjs';
import { canSubmitChallengeLanguage } from '../../../packages/runner-sdk/src/language-policy.mjs';
import { getChallengeBasePath } from '../../api/src/repositories/challenge-repository.mjs';
import {
  claimSubmissionForProcessing,
  finalizeQueuedAttemptAsInfraFailed,
  getSubmission,
  heartbeatSubmissionProcessing,
  listQueuedSubmissions,
  startRetryAttempt,
  updateSubmissionForAttempt
} from '../../api/src/repositories/submission-repository.mjs';
import { getApplicationRetryBackoffConfig } from './config/application-retry-backoff-config.mjs';
import { getProcessingLeaseConfig } from './config/processing-lease-config.mjs';
import { loadWorkerQueueConsumerConfig } from './config/queue-consumer-config.mjs';
import { getStaleRecoveryConfig } from './config/stale-recovery-config.mjs';
import { createApplicationRetryBackoff } from './services/application-retry-backoff.mjs';
import { runJavaScriptChallenge, runJavaScriptChallengeViaIsolatedJob } from './services/js-runner.mjs';
import { createWorkerQueueConsumerRuntime } from './services/queue-consumer-runtime.mjs';
import { startStaleRecoveryScanner } from './services/stale-recovery-scanner.mjs';

const port = Number(process.env.WORKER_PORT ?? 8081);
const useIsolationPoc = process.env.RUNNER_ISOLATION_POC === '1';
const isProduction = process.env.NODE_ENV === 'production';
const maxInfraRetryAttempts = Number(process.env.WORKER_MAX_INFRA_RETRY_ATTEMPTS ?? 2);
const retryEnqueueBaseUrl = process.env.WORKER_RETRY_ENQUEUE_BASE_URL ?? `http://localhost:${port}`;
const applicationRetryBackoffConfig = getApplicationRetryBackoffConfig(process.env);
const applicationRetryBackoff = createApplicationRetryBackoff({ config: applicationRetryBackoffConfig });
const processingLeaseConfig = getProcessingLeaseConfig(process.env);
const staleRecoveryConfig = getStaleRecoveryConfig(process.env, {
  heartbeatEnabled: processingLeaseConfig.enabled
});
const queueConsumerConfig = loadWorkerQueueConsumerConfig(process.env);
const queueEventLogger = createQueueEventLogger({ service: 'worker' });
let queueConsumerRuntime;

if (useIsolationPoc && isProduction) {
  throw new Error('RUNNER_ISOLATION_POC must not be enabled in production.');
}

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const shouldRetryInfraFailure = (attempt) => attempt < maxInfraRetryAttempts;

const getExpectedAttempt = (submission) => ({
  gradingAttempt: submission.gradingAttempt,
  attemptIdempotencyKey: submission.attemptIdempotencyKey
});

const createHeartbeatController = (submission) => {
  if (!processingLeaseConfig.enabled) {
    return {
      hasOwnership: () => true,
      stop: () => {}
    };
  }

  let ownsLease = true;
  let heartbeatRunning = false;
  const expectedAttempt = getExpectedAttempt(submission);

  const heartbeat = async () => {
    if (!ownsLease || heartbeatRunning) return;
    heartbeatRunning = true;

    try {
      const updated = await heartbeatSubmissionProcessing({
        id: submission.id,
        ...expectedAttempt,
        leaseDurationMs: processingLeaseConfig.leaseDurationMs
      });
      if (!updated) ownsLease = false;
    } catch (error) {
      ownsLease = false;
      queueEventLogger.error(QUEUE_EVENTS.HEARTBEAT_FAILED, {
        submissionId: submission.id,
        gradingAttempt: submission.gradingAttempt,
        reason: 'heartbeat_update_failed',
        errorType: error?.name ?? 'Error'
      });
    } finally {
      heartbeatRunning = false;
    }
  };

  const timer = setInterval(() => {
    void heartbeat();
  }, processingLeaseConfig.heartbeatIntervalMs);
  timer.unref?.();

  return {
    hasOwnership: () => ownsLease,
    stop: () => clearInterval(timer)
  };
};

const handleInfrastructureFailure = async ({ submissionId, submission, error }) => {
  const expectedAttempt = getExpectedAttempt(submission);

  if (!shouldRetryInfraFailure(submission.gradingAttempt ?? 1)) {
    const terminalized = await updateSubmissionForAttempt(submissionId, {
      status: 'infra_failed',
      result: {
        status: 'infra_failed',
        score: 0,
        durationMs: 0,
        logs: [error.message],
        testResults: [],
        artifacts: []
      }
    }, expectedAttempt);
    if (terminalized) {
      queueEventLogger.error(QUEUE_EVENTS.RETRY_TERMINALIZED, {
        submissionId,
        gradingAttempt: submission.gradingAttempt,
        outcome: 'infra_failed',
        reason: 'max_attempts_reached'
      });
    }
    return Boolean(terminalized);
  }

  const retryPending = await updateSubmissionForAttempt(
    submissionId,
    { status: 'retry_pending' },
    expectedAttempt
  );
  if (!retryPending) {
    queueEventLogger.warn(QUEUE_EVENTS.RETRY_PENDING, {
      submissionId,
      gradingAttempt: submission.gradingAttempt,
      outcome: 'no_op',
      reason: 'conditional_update_failed'
    });
    return false;
  }

  queueEventLogger.info(QUEUE_EVENTS.RETRY_PENDING, {
    submissionId,
    gradingAttempt: submission.gradingAttempt,
    outcome: 'updated',
    reason: 'infrastructure_failure'
  });

  const retriedSubmission = await startRetryAttempt(submissionId, expectedAttempt);
  if (!retriedSubmission) {
    queueEventLogger.warn(QUEUE_EVENTS.RETRY_STARTED, {
      submissionId,
      gradingAttempt: submission.gradingAttempt,
      outcome: 'no_op',
      reason: 'conditional_start_failed'
    });
    return false;
  }

  queueEventLogger.info(QUEUE_EVENTS.RETRY_STARTED, {
    submissionId,
    previousAttempt: submission.gradingAttempt,
    nextAttempt: retriedSubmission.gradingAttempt,
    outcome: 'queued'
  });

  const retryDelay = applicationRetryBackoff.calculate({
    nextAttempt: retriedSubmission.gradingAttempt
  });
  queueEventLogger.info(QUEUE_EVENTS.RETRY_DELAY_SCHEDULED, {
    submissionId,
    previousAttempt: submission.gradingAttempt,
    nextAttempt: retriedSubmission.gradingAttempt,
    retryOrdinal: retryDelay.retryOrdinal,
    delayMs: retryDelay.delayMs,
    capDelayMs: retryDelay.capDelayMs,
    backoffEnabled: retryDelay.backoffEnabled,
    outcome: retryDelay.delayMs > 0 ? 'scheduled' : 'immediate'
  });

  try {
    await applicationRetryBackoff.wait(retryDelay.delayMs);
  } catch (delayError) {
    queueEventLogger.warn(QUEUE_EVENTS.RETRY_DELAY_FAILED, {
      submissionId,
      gradingAttempt: retriedSubmission.gradingAttempt,
      retryOrdinal: retryDelay.retryOrdinal,
      delayMs: retryDelay.delayMs,
      backoffEnabled: retryDelay.backoffEnabled,
      outcome: 'fallback_immediate',
      reason: 'delay_wait_failed',
      errorType: delayError?.name ?? 'Error'
    });
  }

  const enqueued = await queueConsumerRuntime.enqueue({
    submissionId,
    gradingAttempt: retriedSubmission.gradingAttempt,
    attemptIdempotencyKey: retriedSubmission.attemptIdempotencyKey,
    eventLogger: queueEventLogger,
    source: 'application_retry'
  });

  if (enqueued) {
    queueEventLogger.info(QUEUE_EVENTS.RETRY_ENQUEUE_SUCCEEDED, {
      submissionId,
      gradingAttempt: retriedSubmission.gradingAttempt,
      outcome: 'accepted'
    });
    return true;
  }

  queueEventLogger.error(QUEUE_EVENTS.RETRY_ENQUEUE_FAILED, {
    submissionId,
    gradingAttempt: retriedSubmission.gradingAttempt,
    outcome: 'failed',
    reason: 'enqueue_failed'
  });

  const finalized = await finalizeQueuedAttemptAsInfraFailed(
    submissionId,
    {
      status: 'infra_failed',
      score: 0,
      durationMs: 0,
      logs: ['Retryジョブの再投入に失敗しました。'],
      testResults: [],
      artifacts: []
    },
    getExpectedAttempt(retriedSubmission)
  );

  if (finalized) {
    queueEventLogger.error(QUEUE_EVENTS.RETRY_TERMINALIZED, {
      submissionId,
      gradingAttempt: retriedSubmission.gradingAttempt,
      outcome: 'infra_failed',
      reason: 'enqueue_failed'
    });
  }
  return Boolean(finalized);
};

const processSubmission = async ({ submissionId, gradingAttempt, attemptIdempotencyKey }) => {
  const current = await getSubmission(submissionId);
  if (!current) {
    queueEventLogger.info(QUEUE_EVENTS.CLAIM_NOOP, {
      submissionId,
      gradingAttempt,
      outcome: 'no_op',
      reason: 'submission_not_found'
    });
    return { acknowledge: true, reason: 'submission_not_found' };
  }

  if (typeof gradingAttempt === 'number' && attemptIdempotencyKey) {
    if (current.gradingAttempt !== gradingAttempt || current.attemptIdempotencyKey !== attemptIdempotencyKey) {
      queueEventLogger.info(QUEUE_EVENTS.CLAIM_NOOP, {
        submissionId,
        gradingAttempt,
        outcome: 'no_op',
        reason: 'attempt_mismatch'
      });
      return { acknowledge: true, reason: 'attempt_mismatch' };
    }
  }

  const submission = await claimSubmissionForProcessing({
    id: submissionId,
    gradingAttempt: current.gradingAttempt,
    attemptIdempotencyKey: current.attemptIdempotencyKey,
    leaseDurationMs: processingLeaseConfig.enabled ? processingLeaseConfig.leaseDurationMs : null
  });
  if (!submission) {
    queueEventLogger.info(QUEUE_EVENTS.CLAIM_NOOP, {
      submissionId,
      gradingAttempt: current.gradingAttempt,
      outcome: 'no_op',
      reason: 'conditional_claim_failed'
    });
    return { acknowledge: true, reason: 'conditional_claim_failed' };
  }

  queueEventLogger.info(QUEUE_EVENTS.CLAIM_SUCCEEDED, {
    submissionId,
    gradingAttempt: submission.gradingAttempt,
    outcome: 'running'
  });

  const heartbeatController = createHeartbeatController(submission);
  const expectedAttempt = getExpectedAttempt(submission);

  try {
    const challengeBasePath = getChallengeBasePath(submission.challengeSlug);
    const challenge = await readJson(path.join(challengeBasePath, 'problem.json'));

    if (!canSubmitChallengeLanguage(challenge, submission.language)) {
      if (!heartbeatController.hasOwnership()) {
        return { acknowledge: false, reason: 'processing_ownership_lost' };
      }
      const updated = await updateSubmissionForAttempt(submissionId, {
        status: 'failed',
        result: {
          status: 'failed',
          score: 0,
          durationMs: 0,
          logs: ['このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。'],
          testResults: [],
          artifacts: []
        }
      }, expectedAttempt);
      return {
        acknowledge: Boolean(updated),
        reason: updated ? 'terminal_saved' : 'terminal_save_not_confirmed'
      };
    }

    const normalizedResult = useIsolationPoc
      ? await runJavaScriptChallengeViaIsolatedJob({
          challenge,
          challengeBasePath,
          code: submission.code,
          language: submission.language
        })
      : await runJavaScriptChallenge({
          challenge,
          challengeBasePath,
          code: submission.code,
          language: submission.language
        });

    if (!heartbeatController.hasOwnership()) {
      return { acknowledge: false, reason: 'processing_ownership_lost' };
    }
    const updated = await updateSubmissionForAttempt(
      submissionId,
      { status: 'completed', result: normalizedResult },
      expectedAttempt
    );
    return {
      acknowledge: Boolean(updated),
      reason: updated ? 'terminal_saved' : 'terminal_save_not_confirmed'
    };
  } catch (error) {
    if (!heartbeatController.hasOwnership()) {
      return { acknowledge: false, reason: 'processing_ownership_lost' };
    }
    const handled = await handleInfrastructureFailure({ submissionId, submission, error });
    return {
      acknowledge: Boolean(handled),
      reason: handled ? 'infrastructure_failure_handled' : 'infrastructure_failure_not_confirmed'
    };
  } finally {
    heartbeatController.stop();
  }
};

queueConsumerRuntime = createWorkerQueueConsumerRuntime({
  config: queueConsumerConfig,
  processMessage: processSubmission,
  retryEnqueueBaseUrl,
  eventLogger: queueEventLogger
});

const recoverQueuedSubmissions = async () => {
  const queuedSubmissions = await listQueuedSubmissions();

  for (const submission of queuedSubmissions) {
    setImmediate(() => {
      processSubmission({
        submissionId: submission.id,
        gradingAttempt: submission.gradingAttempt,
        attemptIdempotencyKey: submission.attemptIdempotencyKey
      });
    });
  }

  return queuedSubmissions.length;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'worker' });
  }

  if (req.method === 'POST' && url.pathname === '/jobs') {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      queueEventLogger.warn(QUEUE_EVENTS.DELIVERY_REJECTED, {
        transport: 'http',
        outcome: 'rejected',
        reason: 'invalid_json'
      });
      return sendJson(res, 400, { error: 'invalid queue message', code: 'invalid_json' });
    }

    const parsed = parseSubmissionQueueMessage(body);
    if (!parsed.success) {
      queueEventLogger.warn(QUEUE_EVENTS.DELIVERY_REJECTED, {
        transport: 'http',
        outcome: 'rejected',
        reason: parsed.error.code,
        field: parsed.error.field,
        submissionId: body?.submissionId,
        gradingAttempt: body?.gradingAttempt,
        correlationId: body?.correlationId,
        schemaVersion: body?.schemaVersion
      });
      return sendJson(res, 400, {
        error: 'invalid queue message',
        code: parsed.error.code,
        field: parsed.error.field
      });
    }

    const message = parsed.data;
    queueEventLogger.info(QUEUE_EVENTS.DELIVERY_ACCEPTED, {
      transport: 'http',
      outcome: 'accepted',
      submissionId: message.submissionId,
      gradingAttempt: message.gradingAttempt,
      correlationId: message.correlationId,
      schemaVersion: message.schemaVersion
    });

    setImmediate(() => {
      processSubmission({
        submissionId: message.submissionId,
        gradingAttempt: message.gradingAttempt,
        attemptIdempotencyKey: message.attemptIdempotencyKey
      });
    });

    return sendJson(res, 202, {
      accepted: true,
      submissionId: message.submissionId,
      gradingAttempt: message.gradingAttempt
    });
  }

  return sendJson(res, 404, { error: 'not found' });
});

server.on('close', () => {
  void queueConsumerRuntime.close();
});

server.listen(port, () => {
  console.log(`worker listening on http://localhost:${port}`);
  queueConsumerRuntime.start();

  void recoverQueuedSubmissions()
    .then((count) => {
      queueEventLogger.info(QUEUE_EVENTS.QUEUED_RECOVERY_COMPLETED, {
        trigger: 'startup',
        outcome: 'completed',
        count
      });
    })
    .catch((error) => {
      queueEventLogger.error(QUEUE_EVENTS.QUEUED_RECOVERY_FAILED, {
        trigger: 'startup',
        outcome: 'failed',
        reason: 'list_or_schedule_failed',
        errorType: error?.name ?? 'Error'
      });
    });

  startStaleRecoveryScanner({
    config: staleRecoveryConfig,
    maxInfraRetryAttempts,
    retryEnqueueBaseUrl,
    enqueueAttempt: queueConsumerRuntime.enqueue,
    eventLogger: queueEventLogger
  });
});