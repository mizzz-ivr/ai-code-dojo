import { createHash } from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPythonRunnerSignature } from '../../../packages/runner-sdk/src/python-remote-auth.mjs';
import { loadPythonRunnerServiceConfig } from './config.mjs';
import { cleanupOrphanedPythonContainers } from './services/python-invocation-container.mjs';
import { runPythonCaseChallenge } from './services/python-case-runner.mjs';
import {
  createPythonRunnerJobRegistry,
  PythonRunnerBusyError,
  PythonRunnerIdempotencyConflictError
} from './services/job-registry.mjs';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const SLUG_PATTERN = /^[a-z0-9-]{1,120}$/;

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
};

const readBody = async (req, maxBytes) => {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const resolveChallengeBasePath = (problemsRoot, slug) => {
  if (!SLUG_PATTERN.test(slug)) throw new Error('invalid_challenge_slug');
  const root = path.resolve(problemsRoot);
  const resolved = path.resolve(root, slug);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('invalid_challenge_slug');
  return resolved;
};

const validatePayload = (payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('invalid_payload');
  if (typeof payload.jobId !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(payload.jobId)) throw new Error('invalid_payload');
  if (typeof payload.challengeSlug !== 'string' || !SLUG_PATTERN.test(payload.challengeSlug)) throw new Error('invalid_payload');
  if (typeof payload.code !== 'string' || Buffer.byteLength(payload.code, 'utf8') === 0 || Buffer.byteLength(payload.code, 'utf8') > 64 * 1024) {
    throw new Error('invalid_payload');
  }
  return payload;
};

export const createPythonRunnerServer = ({
  config = loadPythonRunnerServiceConfig(process.env),
  runPythonChallenge = runPythonCaseChallenge,
  registry = createPythonRunnerJobRegistry(config),
  now = () => Date.now()
} = {}) => http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'python-runner', stats: registry.getStats() });
  }
  if (req.method !== 'POST' || url.pathname !== '/v1/jobs') {
    return sendJson(res, 404, { error: 'not_found' });
  }

  let body;
  try {
    body = await readBody(req, config.maxRequestBytes);
  } catch {
    return sendJson(res, 413, { error: 'request_too_large' });
  }

  const timestamp = req.headers['x-runner-timestamp'];
  const idempotencyKey = req.headers['x-runner-idempotency-key'];
  const signature = req.headers['x-runner-signature'];
  if (typeof timestamp !== 'string' || typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }
  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(now() - timestampNumber) > config.maxClockSkewMs) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }
  if (!verifyPythonRunnerSignature({
    secret: config.sharedSecret,
    timestamp,
    idempotencyKey,
    body,
    signature
  })) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  let payload;
  try {
    payload = validatePayload(JSON.parse(body));
  } catch {
    return sendJson(res, 400, { error: 'invalid_payload' });
  }
  if (payload.jobId !== idempotencyKey) {
    return sendJson(res, 409, { error: 'idempotency_mismatch' });
  }

  const payloadHash = createHash('sha256').update(body, 'utf8').digest('hex');
  try {
    const result = await registry.execute({
      idempotencyKey,
      payloadHash,
      run: async () => {
        const challengeBasePath = resolveChallengeBasePath(config.problemsRoot, payload.challengeSlug);
        const challenge = JSON.parse(await readFile(path.join(challengeBasePath, 'problem.json'), 'utf8'));
        if (challenge?.metadata?.slug !== payload.challengeSlug || challenge?.metadata?.supportedLanguages?.includes('python') !== true) {
          throw new Error('challenge_not_available');
        }
        return runPythonChallenge({
          challenge,
          challengeBasePath,
          code: payload.code
        });
      }
    });
    return sendJson(res, 200, { ok: true, result });
  } catch (error) {
    if (error instanceof PythonRunnerBusyError) return sendJson(res, 429, { error: 'runner_busy' });
    if (error instanceof PythonRunnerIdempotencyConflictError) return sendJson(res, 409, { error: 'idempotency_conflict' });
    return sendJson(res, 503, { error: 'runner_execution_failed' });
  }
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadPythonRunnerServiceConfig(process.env);
  cleanupOrphanedPythonContainers().catch(() => {});
  const server = createPythonRunnerServer({ config });
  server.listen(config.port, () => {
    process.stdout.write(JSON.stringify({ event: 'python_runner.started', port: config.port }) + '\n');
  });
}
