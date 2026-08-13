import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const PYTHON_RUNNER_IMAGE = 'python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd';
export const MAX_PYTHON_CODE_BYTES = 64 * 1024;
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_CALLS_PER_BATCH = 64;
const FUNCTION_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const DOCKER_INFRA_FAILURE_EXIT_CODES = new Set([125, 126, 127]);

const HARNESS_SOURCE = `import contextlib
import importlib.util
import io
import json
import sys


def load_submission():
    spec = importlib.util.spec_from_file_location("submission", "/workspace/submission.py")
    module = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return module


def main():
    payload = json.load(sys.stdin)
    module = load_submission()
    results = []
    for call in payload.get("calls", []):
        try:
            fn = getattr(module, call["function"])
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                value = fn(*call.get("args", []), **call.get("kwargs", {}))
            json.dumps(value)
            results.append({"id": call["id"], "ok": True, "value": value})
        except Exception as error:
            results.append({"id": call.get("id", "unknown"), "ok": False, "errorType": type(error).__name__})
    json.dump({"results": results}, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
`;

const appendLimited = (current, chunk) => {
  if (Buffer.byteLength(current, 'utf8') >= MAX_CAPTURE_BYTES) return current;
  const next = current + chunk.toString('utf8');
  if (Buffer.byteLength(next, 'utf8') <= MAX_CAPTURE_BYTES) return next;
  return Buffer.from(next, 'utf8').subarray(0, MAX_CAPTURE_BYTES).toString('utf8');
};

const validateCalls = (calls) => {
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > MAX_CALLS_PER_BATCH) {
    throw new Error('python invocation calls are invalid');
  }
  return calls.map((call) => {
    if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 120) {
      throw new Error('python invocation id is invalid');
    }
    if (typeof call.function !== 'string' || !FUNCTION_PATTERN.test(call.function)) {
      throw new Error('python invocation function is invalid');
    }
    const args = call.args ?? [];
    const kwargs = call.kwargs ?? {};
    if (!Array.isArray(args) || !kwargs || typeof kwargs !== 'object' || Array.isArray(kwargs)) {
      throw new Error('python invocation arguments are invalid');
    }
    JSON.stringify({ args, kwargs });
    return { id: call.id, function: call.function, args, kwargs };
  });
};

const createTerminalFailure = (calls, errorType, diagnostics) => ({
  results: calls.map((call) => ({ id: call.id, ok: false, errorType })),
  diagnostics
});

export const buildPythonInvocationContainerArgs = ({
  workingDirectory,
  containerName,
  image = PYTHON_RUNNER_IMAGE,
  cpuLimit = '0.5',
  memoryLimit = '256m',
  pidsLimit = 64,
  tmpfs = '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777'
}) => [
  'run', '--rm', '-i',
  '--name', containerName,
  '--label', 'ai-code-dojo.python-runner=1',
  '--network', 'none',
  '--read-only',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges=true',
  '--user', '65534:65534',
  '--tmpfs', tmpfs,
  '--cpus', cpuLimit,
  '--memory', memoryLimit,
  '--pids-limit', String(pidsLimit),
  '--ulimit', 'nofile=64:64',
  '--stop-timeout', '3',
  '-v', `${workingDirectory}:/workspace:ro`,
  '-w', '/workspace',
  image,
  'python', '-I', '-B', '/workspace/invoke.py'
];

const removeContainer = ({ containerName, spawnImpl }) => new Promise((resolve) => {
  const cleanup = spawnImpl('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  const timer = setTimeout(() => {
    cleanup.kill?.('SIGKILL');
    resolve();
  }, 3000);
  cleanup.on('error', () => {
    clearTimeout(timer);
    resolve();
  });
  cleanup.on('close', () => {
    clearTimeout(timer);
    resolve();
  });
});

export const runPythonInvocationBatchInContainer = async ({
  code,
  calls,
  timeoutMs,
  spawnImpl = spawn
}) => {
  if (typeof code !== 'string' || Buffer.byteLength(code, 'utf8') === 0 || Buffer.byteLength(code, 'utf8') > MAX_PYTHON_CODE_BYTES) {
    throw new Error('python submission code is invalid');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new Error('python invocation timeout is invalid');
  }

  const validatedCalls = validateCalls(calls);
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-dojo-python-executor-'));
  const containerName = `ai-dojo-python-${randomUUID().replaceAll('-', '').slice(0, 24)}`;

  try {
    await writeFile(path.join(tmpRoot, 'submission.py'), code, { encoding: 'utf8', mode: 0o444 });
    await writeFile(path.join(tmpRoot, 'invoke.py'), HARNESS_SOURCE, { encoding: 'utf8', mode: 0o444 });
    await chmod(tmpRoot, 0o555);
    const payload = JSON.stringify({ calls: validatedCalls });
    const args = buildPythonInvocationContainerArgs({ workingDirectory: tmpRoot, containerName });

    return await new Promise((resolve, reject) => {
      const child = spawnImpl('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let settled = false;
      let killTimer;

      const settle = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        callback();
      };

      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill?.('SIGTERM');
        killTimer = setTimeout(() => child.kill?.('SIGKILL'), 1000);
        void removeContainer({ containerName, spawnImpl }).then(() => {
          if (killTimer) clearTimeout(killTimer);
          resolve(createTerminalFailure(validatedCalls, 'TimeoutError', 'timeout'));
        });
      }, timeoutMs + 1000);

      child.stdout?.on('data', (chunk) => { stdout = appendLimited(stdout, chunk); });
      child.on('error', () => settle(() => reject(new Error('python sandbox unavailable'))));
      child.stdin?.on('error', () => {});
      child.stdin?.end(payload, 'utf8');
      child.on('close', (code) => {
        if (settled) return;
        if (DOCKER_INFRA_FAILURE_EXIT_CODES.has(code)) {
          settle(() => reject(new Error('python sandbox unavailable')));
          return;
        }
        if (code !== 0) {
          settle(() => resolve(createTerminalFailure(validatedCalls, 'RuntimeError', 'runtime-failed')));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          if (!Array.isArray(parsed?.results) || parsed.results.length !== validatedCalls.length) {
            throw new Error('invalid result');
          }
          settle(() => resolve({ results: parsed.results, diagnostics: 'ok' }));
        } catch {
          settle(() => resolve(createTerminalFailure(validatedCalls, 'ProtocolError', 'protocol-failed')));
        }
      });
    });
  } finally {
    await chmod(tmpRoot, 0o700).catch(() => {});
    await rm(tmpRoot, { recursive: true, force: true });
  }
};

const captureCommand = ({ command, args, spawnImpl }) => new Promise((resolve) => {
  const child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let stdout = '';
  child.stdout?.on('data', (chunk) => { stdout = appendLimited(stdout, chunk); });
  child.on('error', () => resolve(''));
  child.on('close', () => resolve(stdout));
});

export const cleanupOrphanedPythonContainers = async ({ spawnImpl = spawn } = {}) => {
  const raw = await captureCommand({
    command: 'docker',
    args: ['ps', '-aq', '--filter', 'label=ai-code-dojo.python-runner=1'],
    spawnImpl
  });
  const containerIds = raw.split(/\s+/).map((value) => value.trim()).filter(Boolean);
  if (containerIds.length === 0) return 0;
  await new Promise((resolve) => {
    const child = spawnImpl('docker', ['rm', '-f', ...containerIds], { stdio: 'ignore' });
    child.on('error', resolve);
    child.on('close', resolve);
  });
  return containerIds.length;
};
