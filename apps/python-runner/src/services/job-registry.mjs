export class PythonRunnerBusyError extends Error {
  constructor() {
    super('python runner is busy');
    this.name = 'PythonRunnerBusyError';
  }
}

export class PythonRunnerIdempotencyConflictError extends Error {
  constructor() {
    super('python runner idempotency key conflict');
    this.name = 'PythonRunnerIdempotencyConflictError';
  }
}

export const createPythonRunnerJobRegistry = ({
  maxConcurrency,
  maxQueuedJobs,
  idempotencyTtlMs,
  now = () => Date.now()
}) => {
  let activeCount = 0;
  const queue = [];
  const entries = new Map();

  const cleanupExpired = () => {
    const current = now();
    for (const [key, entry] of entries) {
      if (entry.state === 'completed' && entry.expiresAt <= current) entries.delete(key);
    }
  };

  const pump = () => {
    while (activeCount < maxConcurrency && queue.length > 0) {
      const next = queue.shift();
      activeCount += 1;
      Promise.resolve()
        .then(next.run)
        .then(next.resolve, next.reject)
        .finally(() => {
          activeCount -= 1;
          pump();
        });
    }
  };

  const schedule = ({ run }) => new Promise((resolve, reject) => {
    if (activeCount >= maxConcurrency && queue.length >= maxQueuedJobs) {
      reject(new PythonRunnerBusyError());
      return;
    }
    queue.push({ run, resolve, reject });
    pump();
  });

  const execute = async ({ idempotencyKey, payloadHash, run }) => {
    cleanupExpired();
    const existing = entries.get(idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new PythonRunnerIdempotencyConflictError();
      return existing.state === 'completed' ? existing.result : existing.promise;
    }

    const promise = schedule({ run });
    entries.set(idempotencyKey, { state: 'running', payloadHash, promise });
    try {
      const result = await promise;
      entries.set(idempotencyKey, {
        state: 'completed',
        payloadHash,
        result,
        expiresAt: now() + idempotencyTtlMs
      });
      return result;
    } catch (error) {
      entries.delete(idempotencyKey);
      throw error;
    }
  };

  return Object.freeze({
    execute,
    getStats: () => Object.freeze({ activeCount, queuedCount: queue.length, idempotencyEntries: entries.size })
  });
};
