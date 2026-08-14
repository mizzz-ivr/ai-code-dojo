import path from 'node:path';

const readInteger = (value, fallback, { min, max, name }) => {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} is invalid`);
  }
  return parsed;
};

export const loadPythonRunnerServiceConfig = (env = process.env) => {
  const sharedSecret = env.PYTHON_RUNNER_SHARED_SECRET ?? '';
  if (sharedSecret.length < 32) {
    throw new Error('PYTHON_RUNNER_SHARED_SECRET must be at least 32 characters');
  }

  return Object.freeze({
    port: readInteger(env.PYTHON_RUNNER_PORT, 8090, { min: 1, max: 65535, name: 'PYTHON_RUNNER_PORT' }),
    sharedSecret,
    problemsRoot: path.resolve(env.PYTHON_RUNNER_PROBLEMS_ROOT ?? 'problems/examples'),
    maxConcurrency: readInteger(env.PYTHON_RUNNER_MAX_CONCURRENCY, 2, { min: 1, max: 16, name: 'PYTHON_RUNNER_MAX_CONCURRENCY' }),
    maxQueuedJobs: readInteger(env.PYTHON_RUNNER_MAX_QUEUED_JOBS, 8, { min: 0, max: 128, name: 'PYTHON_RUNNER_MAX_QUEUED_JOBS' }),
    idempotencyTtlMs: readInteger(env.PYTHON_RUNNER_IDEMPOTENCY_TTL_MS, 600000, { min: 1000, max: 3600000, name: 'PYTHON_RUNNER_IDEMPOTENCY_TTL_MS' }),
    maxClockSkewMs: readInteger(env.PYTHON_RUNNER_MAX_CLOCK_SKEW_MS, 60000, { min: 1000, max: 300000, name: 'PYTHON_RUNNER_MAX_CLOCK_SKEW_MS' }),
    maxRequestBytes: readInteger(env.PYTHON_RUNNER_MAX_REQUEST_BYTES, 98304, { min: 1024, max: 262144, name: 'PYTHON_RUNNER_MAX_REQUEST_BYTES' })
  });
};
