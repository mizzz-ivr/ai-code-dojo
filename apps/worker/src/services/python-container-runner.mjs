import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const PYTHON_RUNNER_IMAGE = 'python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd';

const resolveWorkspacePath = (workingDirectory, relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('challenge file path is invalid');
  }
  const resolved = path.resolve(workingDirectory, relativePath);
  const root = `${path.resolve(workingDirectory)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('challenge file path escapes workspace');
  return resolved;
};

export const buildPythonContainerArgs = ({
  workingDirectory,
  testPath,
  image = PYTHON_RUNNER_IMAGE,
  cpuLimit = '0.5',
  memoryLimit = '256m',
  pidsLimit = 64,
  tmpfs = '/tmp:rw,noexec,nosuid,size=64m'
}) => [
  'run', '--rm',
  '--network', 'none',
  '--read-only',
  '--tmpfs', tmpfs,
  '--cpus', cpuLimit,
  '--memory', memoryLimit,
  '--pids-limit', String(pidsLimit),
  '-v', `${workingDirectory}:/workspace:ro`,
  '-w', '/workspace',
  image,
  'python', '-I', '-B', testPath
];

export const runPythonTestInContainer = ({
  workingDirectory,
  testPath,
  timeoutMs,
  visibility,
  spawnImpl = spawn
}) => new Promise((resolve) => {
  const started = Date.now();
  const args = buildPythonContainerArgs({ workingDirectory, testPath });
  const child = spawnImpl('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;
  let killTimer;

  const finish = (message, passed) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    resolve({
      output: `${stdout}\n${stderr}`.trim(),
      result: {
        testId: `${visibility}-suite`,
        passed,
        message,
        durationMs: Date.now() - started,
        visibility
      }
    });
  };

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill?.('SIGTERM');
    killTimer = setTimeout(() => child.kill?.('SIGKILL'), 3000);
  }, timeoutMs + 5000);

  child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.on('error', (error) => finish(`runtime unavailable: ${error.code ?? error.message}`, false));
  child.on('close', (code) => {
    if (timedOut) return finish('timeout', false);
    return finish(code === 0 ? 'ok' : 'failed', code === 0);
  });
});

export const runPythonChallengeInContainer = async ({ challenge, challengeBasePath, code }) => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-dojo-python-'));
  const workingDirectory = path.join(tmpRoot, challenge.metadata.slug);
  const startedAt = Date.now();

  try {
    await cp(challengeBasePath, workingDirectory, { recursive: true });
    const editableStarter = challenge.starterCode.find((file) => !file.readonly);
    if (!editableStarter) throw new Error('editable starter file is required');
    await writeFile(resolveWorkspacePath(workingDirectory, editableStarter.path), code, 'utf8');

    const timeoutMs = challenge.runnerConfig.timeoutSeconds * 1000;
    const visiblePath = challenge.visibleTests[0];
    const hiddenPath = challenge.hiddenTests[0];
    resolveWorkspacePath(workingDirectory, visiblePath);
    resolveWorkspacePath(workingDirectory, hiddenPath);

    const visibleRun = await runPythonTestInContainer({
      workingDirectory,
      testPath: visiblePath,
      timeoutMs,
      visibility: 'visible'
    });
    const hiddenRun = await runPythonTestInContainer({
      workingDirectory,
      testPath: hiddenPath,
      timeoutMs,
      visibility: 'hidden'
    });
    const testResults = [visibleRun.result, hiddenRun.result];
    const passedCount = testResults.filter((result) => result.passed).length;

    return {
      status: 'completed',
      score: Math.round((passedCount / testResults.length) * 100),
      durationMs: Date.now() - startedAt,
      logs: [`[visible] ${visibleRun.output}`, '[hidden] hidden tests log is not exposed.'],
      testResults,
      artifacts: []
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
};
