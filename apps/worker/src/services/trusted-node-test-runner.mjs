import { spawn } from 'node:child_process';
import process from 'node:process';

const MAX_CAPTURE_BYTES = 256 * 1024;

const appendLimited = (current, chunk) => {
  if (Buffer.byteLength(current, 'utf8') >= MAX_CAPTURE_BYTES) return current;
  const next = current + chunk.toString('utf8');
  if (Buffer.byteLength(next, 'utf8') <= MAX_CAPTURE_BYTES) return next;
  return Buffer.from(next, 'utf8').subarray(0, MAX_CAPTURE_BYTES).toString('utf8');
};

export const runTrustedNodeTests = ({ cwd, tests, timeoutMs, visibility, spawnImpl = spawn }) =>
  new Promise((resolve) => {
    const started = Date.now();
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: 'test'
    };
    const child = spawnImpl(process.execPath, ['--test', ...tests], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

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
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout = appendLimited(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendLimited(stderr, chunk); });
    child.on('error', (error) => finish(`runtime unavailable: ${error.code ?? error.message}`, false));
    child.on('close', (code, signal) => {
      if (timedOut) return finish('timeout', false);
      if (signal === 'SIGKILL') return finish('killed', false);
      return finish(code === 0 ? 'ok' : 'failed', code === 0);
    });
  });
