import path from 'node:path';
import { spawn } from 'node:child_process';
import { getRunnerContract, RUNNER_KINDS } from '../../../../packages/runner-sdk/src/runner-contract.mjs';
import { runChallenge } from './challenge-runner.mjs';

const inferLanguage = (challenge) => challenge?.metadata?.supportedLanguages?.[0] ?? null;

export const runJavaScriptChallenge = async (input) => runChallenge({
  ...input,
  language: input.language ?? inferLanguage(input.challenge)
});

export const runJavaScriptChallengeViaIsolatedJob = async ({ challenge, challengeBasePath, code, language }) => {
  const resolvedLanguage = language ?? inferLanguage(challenge);
  const contract = getRunnerContract(resolvedLanguage);
  if (contract && contract.kind !== RUNNER_KINDS.NODE_TEST) {
    return runChallenge({ challenge, challengeBasePath, code, language: resolvedLanguage });
  }
  return runJavaScriptChallengeViaIsolatedJobWithSpawn({
    challenge,
    challengeBasePath,
    code,
    spawnImpl: spawn
  });
};

export const runJavaScriptChallengeViaIsolatedJobWithSpawn = async ({
  challenge,
  challengeBasePath,
  code,
  spawnImpl
}) =>
  new Promise((resolve) => {
    const challengePath = path.join(challengeBasePath, 'problem.json');
    const payload = JSON.stringify({ challengePath, challengeBasePath, code });
    const workerRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const entryPath = path.join(workerRoot, 'services', 'isolation-job-runner.mjs');
    const child = spawnImpl('node', [entryPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'development'
      }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    let settled = false;
    const resolveOnce = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const normalizeFailure = (message, parsedFailure = null) => ({
      status: parsedFailure?.result?.status ?? 'failed',
      score: parsedFailure?.result?.score ?? 0,
      durationMs: parsedFailure?.result?.durationMs ?? 0,
      logs: parsedFailure?.result?.logs ?? [message],
      testResults: parsedFailure?.result?.testResults ?? [],
      artifacts: parsedFailure?.result?.artifacts ?? []
    });

    child.stdin.on('error', (error) => {
      resolveOnce(normalizeFailure(`isolation job stdin failed: ${error.code ?? error.message}`));
    });

    child.on('error', (error) => {
      resolveOnce(normalizeFailure(`isolation job spawn failed: ${error.code ?? error.message}`));
    });

    child.stdin.end(payload, 'utf8');

    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout || '{}');
        if (parsed.ok) {
          resolveOnce(parsed.result);
          return;
        }
      } catch {}

      try {
        const parsedFailure = JSON.parse(stdout || '{}');
        if (parsedFailure && parsedFailure.ok === false && parsedFailure.result) {
          resolveOnce(normalizeFailure(stderr || 'isolation job failed', parsedFailure));
          return;
        }
      } catch {}

      resolveOnce(normalizeFailure(stderr || 'isolation job failed'));
    });
  });
