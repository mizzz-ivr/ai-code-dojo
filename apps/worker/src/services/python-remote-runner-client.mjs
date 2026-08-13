import { createHash } from 'node:crypto';
import { createPythonRunnerSignature } from '../../../../packages/runner-sdk/src/python-remote-auth.mjs';
import { loadPythonRemoteRunnerConfig } from '../config/python-remote-runner-config.mjs';

const MAX_RESPONSE_BYTES = 1024 * 1024;

export class PythonRemoteRunnerUnavailableError extends Error {
  constructor(message = 'python remote runner is unavailable') {
    super(message);
    this.name = 'PythonRemoteRunnerUnavailableError';
  }
}

const validateResult = (result) => {
  if (!result || typeof result !== 'object') throw new PythonRemoteRunnerUnavailableError('python remote runner returned invalid result');
  if (!['completed', 'failed'].includes(result.status)) throw new PythonRemoteRunnerUnavailableError('python remote runner returned invalid result');
  if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100) throw new PythonRemoteRunnerUnavailableError('python remote runner returned invalid result');
  if (!Array.isArray(result.logs) || !Array.isArray(result.testResults) || !Array.isArray(result.artifacts)) {
    throw new PythonRemoteRunnerUnavailableError('python remote runner returned invalid result');
  }
  return result;
};

const deriveJobId = ({ challenge, code, jobContext }) => {
  if (typeof jobContext?.attemptIdempotencyKey === 'string' && jobContext.attemptIdempotencyKey) {
    return jobContext.attemptIdempotencyKey;
  }
  const slug = challenge?.metadata?.slug ?? 'unknown';
  return `content-${createHash('sha256').update(`${slug}\0${code}`, 'utf8').digest('hex').slice(0, 48)}`;
};

export const runPythonChallengeRemotely = async ({
  challenge,
  code,
  jobContext,
  config = loadPythonRemoteRunnerConfig(process.env),
  fetchImpl = fetch,
  now = () => Date.now()
}) => {
  if (!config.enabled) throw new PythonRemoteRunnerUnavailableError();
  const jobId = deriveJobId({ challenge, code, jobContext });
  const body = JSON.stringify({
    jobId,
    challengeSlug: challenge?.metadata?.slug,
    code
  });
  const timestamp = String(now());
  const signature = createPythonRunnerSignature({
    secret: config.sharedSecret,
    timestamp,
    idempotencyKey: jobId,
    body
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}/v1/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-runner-timestamp': timestamp,
          'x-runner-idempotency-key': jobId,
          'x-runner-signature': signature
        },
        body,
        signal: controller.signal
      });
    } catch {
      throw new PythonRemoteRunnerUnavailableError();
    }
    if (!response.ok) {
      throw new PythonRemoteRunnerUnavailableError(`python remote runner request failed with status ${response.status}`);
    }
    const contentLength = Number(response.headers?.get?.('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new PythonRemoteRunnerUnavailableError('python remote runner response is too large');
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new PythonRemoteRunnerUnavailableError('python remote runner response is too large');
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new PythonRemoteRunnerUnavailableError('python remote runner returned invalid json');
    }
    if (parsed?.ok !== true) throw new PythonRemoteRunnerUnavailableError('python remote runner returned failure');
    return validateResult(parsed.result);
  } finally {
    clearTimeout(timer);
  }
};
