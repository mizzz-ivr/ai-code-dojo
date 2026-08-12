import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PYTHON_RUNNER_IMAGE,
  buildPythonContainerArgs
} from '../../apps/worker/src/services/python-container-runner.mjs';

test('Python Runnerは固定imageと非shell argvで隔離optionを構築する', () => {
  const args = buildPythonContainerArgs({
    workingDirectory: '/tmp/python-job',
    testPath: 'tests/visible/score_visible_test.py'
  });

  assert.equal(PYTHON_RUNNER_IMAGE, 'python:3.14.6-alpine3.22');
  assert.deepEqual(args.slice(0, 17), [
    'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--cpus', '0.5', '--memory', '256m', '--pids-limit', '64', '-v', '/tmp/python-job:/workspace:ro', '-w', '/workspace'
  ]);
  assert.equal(args.includes('sh'), false);
  assert.equal(args.includes('-lc'), false);
  assert.deepEqual(args.slice(-4), [
    'python', '-I', '-B', 'tests/visible/score_visible_test.py'
  ]);
});
