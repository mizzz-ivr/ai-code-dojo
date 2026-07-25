export const QUEUE_EVENTS = Object.freeze({
  ENQUEUE_SUCCEEDED: 'queue.enqueue.succeeded',
  ENQUEUE_FAILED: 'queue.enqueue.failed',
  DELIVERY_ACCEPTED: 'queue.delivery.accepted',
  DELIVERY_REJECTED: 'queue.delivery.rejected',
  CLAIM_SUCCEEDED: 'queue.claim.succeeded',
  CLAIM_NOOP: 'queue.claim.noop',
  HEARTBEAT_FAILED: 'queue.heartbeat.failed',
  RETRY_PENDING: 'queue.retry.pending',
  RETRY_STARTED: 'queue.retry.started',
  RETRY_ENQUEUE_SUCCEEDED: 'queue.retry.enqueue_succeeded',
  RETRY_ENQUEUE_FAILED: 'queue.retry.enqueue_failed',
  RETRY_TERMINALIZED: 'queue.retry.terminalized',
  QUEUED_RECOVERY_COMPLETED: 'queue.queued_recovery.completed',
  QUEUED_RECOVERY_FAILED: 'queue.queued_recovery.failed',
  STALE_RECOVERY_COMPLETED: 'queue.stale_recovery.completed',
  STALE_RECOVERY_ENQUEUE_FAILED: 'queue.stale_recovery.enqueue_failed',
  STALE_RECOVERY_CANDIDATE_FAILED: 'queue.stale_recovery.candidate_failed',
  STALE_RECOVERY_SCAN_COMPLETED: 'queue.stale_recovery.scan_completed',
  STALE_RECOVERY_SCAN_FAILED: 'queue.stale_recovery.scan_failed'
});

const eventNames = new Set(Object.values(QUEUE_EVENTS));
const levels = new Set(['info', 'warn', 'error']);
const allowedFields = new Set([
  'transport',
  'source',
  'outcome',
  'reason',
  'submissionId',
  'gradingAttempt',
  'previousAttempt',
  'nextAttempt',
  'correlationId',
  'schemaVersion',
  'statusCode',
  'field',
  'trigger',
  'scanned',
  'requeued',
  'terminalized',
  'enqueueFailedFinalized',
  'noOp',
  'errors',
  'count',
  'errorType'
]);

const normalizeValue = (value) => {
  if (typeof value === 'string') return value.slice(0, 256);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
};

const defaultWriteLine = (level, line) => {
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
};

export const createQueueEventLogger = ({
  service,
  writeLine = defaultWriteLine,
  now = () => new Date().toISOString()
}) => {
  if (typeof service !== 'string' || service.length === 0) {
    throw new TypeError('queue event logger service is required');
  }
  if (typeof writeLine !== 'function') {
    throw new TypeError('queue event logger writeLine is required');
  }
  if (typeof now !== 'function') {
    throw new TypeError('queue event logger now is required');
  }

  const emit = (level, event, details = {}) => {
    if (!levels.has(level) || !eventNames.has(event)) return false;

    const payload = {
      timestamp: now(),
      level,
      service,
      event
    };

    if (details && typeof details === 'object' && !Array.isArray(details)) {
      for (const [field, value] of Object.entries(details)) {
        if (!allowedFields.has(field)) continue;
        const normalized = normalizeValue(value);
        if (normalized !== undefined) payload[field] = normalized;
      }
    }

    try {
      writeLine(level, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  return {
    info: (event, details) => emit('info', event, details),
    warn: (event, details) => emit('warn', event, details),
    error: (event, details) => emit('error', event, details)
  };
};

export const createNoopQueueEventLogger = () => ({
  info: () => true,
  warn: () => true,
  error: () => true
});
