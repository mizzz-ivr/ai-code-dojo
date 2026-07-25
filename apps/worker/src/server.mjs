import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSubmissionQueueMessage } from '../../../packages/queue/src/message-contract.mjs';
import { createQueueEventLogger, QUEUE_EVENTS } from '../../../packages/queue/src/queue-event-logger.mjs';
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
import { enqueueSubmissionAttempt } from '../../api/src/services/submission-service.mjs';
import { getProcessingLeaseConfig } from './config/processing-lease-config.mjs';
import { getStaleRecoveryConfig } from './config/stale-recovery-config.mjs';
import { runJavaScriptChallenge, runJavaScriptChallengeViaIsolatedJob } from './services/js-runner.mjs';
import { startStaleRecoveryScanner } from './services/stale-recovery-scanner.mjs';

const port = Number(process.env.WORKER_PORT ?? 8081);
const useIsolationPoc = process.env.RUNNER_ISOLATION_POC === '1';
const isProduction = process.env.NODE_ENV === 'production';
const maxInfraRetryAttempts = Number(process.env.WORKER_MAX_INFRA_RETRY_ATTEMPTS ?? 2);
const retryEnqueueBaseUrl = process.env.WORKER_RETRY_ENQUEUE_BASE_URL ?? `http://localhost:${port}`;
const processingLeaseConfig = getProcessingLeaseConfig(process.env);
const staleRecoveryConfig = getStaleRecoveryConfig(process.env, {
  heartbeatEnabled: processingLeaseConfig.enabled
});
const queueEventLogger = createQueueEventLogger({ service: 'worker' });

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
    return;
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
    return;
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
    return;
  }

  queueEventLogger.info(QUEUE_EVENTS.RETRY_STARTED, {
    submissionId,
    previousAttempt: submission.gradingAttempt,
    nextAttempt: retriedSubmission.gradingAttempt,
    outcome: 'queued'
  });

  const enqueued = await enqueueSubmissionAttempt({
    submissionId,
    gradingAttempt: retriedSubmission.gradingAttempt,
    attemptIdempotencyKey: retriedSubmission.attemptIdempotencyKey,
    runnerApiBaseUrl: retryEnqueueBaseUrl,
    eventLogger: queueEventLogger,
    source: 'application_retry'
  });

  if (enqueued) {
    queueEventLogger.info(QUEUE_EVENTS.RETRY_ENQUEUE_SUCCEEDED, {
      submissionId,
      gradingAttempt: retriedSubmission.gradingAttempt,
      outcome: 'accepted'
    });
    return;
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
    return;
  }

  if (typeof gradingAttempt === 'number' && attemptIdempotencyKey) {
    if (current.gradingAttempt !== gradingAttempt || current.attemptIdempotencyKey !== attemptIdempotencyKey) {
      queueEventLogger.info(QUEUE_EVENTS.CLAIM_NOOP, {
        submissionId,
        gradingAttempt,
        outcome: 'no_op',
        reason: 'attempt_mismatch'
      });
      return;
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
    return;
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

    if (submission.language !== 'javascript') {
      if (!heartbeatController.hasOwnership()) return;
      await updateSubmissionForAttempt(submissionId, {
        status: 'failed',
        result: {
          status: 'failed',
          score: 0,
          durationMs: 0,
          logs: ['このMVPではJavaScriptのみ採点対応です。'],
          testResults: [],
          artifacts: []
        }
      }, expectedAttempt);
      return;
    }

    const normalizedResult = useIsolationPoc
      ? await runJavaScriptChallengeViaIsolatedJob({
          challenge,
          challengeBasePath,
          code: submission.code
        })
      : await runJavaScriptChallenge({
          challenge,
          challengeBasePath,
          code: submission.code
        });

    if (!heartbeatController.hasOwnership()) return;
    await updateSubmissionForAttempt(
      submissionId,
      { status: 'completed', result: normalizedResult },
      expectedAttempt
    );
  } catch (error) {
    if (!heartbeatController.hasOwnership()) return;
    await handleInfrastructureFailure({ submissionId, submission, error });
  } finally {
    heartbeatController.stop();
  }
};

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

server.listen(port, () => {
  console.log(`worker listening on http://localhost:${port}`);
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
    eventLogger: queueEventLogger
  });
});
