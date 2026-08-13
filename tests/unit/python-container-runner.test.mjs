import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PYTHON_RUNNER_IMAGE,
  buildPythonContainerArgs
} from '../../apps/worker/src/services/python-container-runner.mjs';

const EXPECTED_IMAGE = 'python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd';

test('Python Runnerは固定image digestと非shell argvで隔離optionを構築する', () => {
  const args = buildPythonContainerArgs({
    workingDirectory: '/tmp/python-job',
    testPath: 'tests/visible/score_visible_test.py'
  });

  assert.equal(PYTHON_RUNNER_IMAGE, EXPECTED_IMAGE);
  assert.deepEqual(args.slice(0, 5), ['run', '--rm', '--network', 'none', '--read-only']);
  assert.deepEqual(args.slice(args.indexOf('--cap-drop'), args.indexOf('--cap-drop') + 2), ['--cap-drop', 'ALL']);
  assert.deepEqual(
    args.slice(args.indexOf('--security-opt'), args.indexOf('--security-opt') + 2),
    ['--security-opt', 'no-new-privileges=true']
  );
  assert.deepEqual(args.slice(args.indexOf('--user'), args.indexOf('--user') + 2), ['--user', '65534:65534']);
  assert.equal(args.includes('/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777'), true);
  assert.deepEqual(args.slice(args.indexOf('--cpus'), args.indexOf('--cpus') + 2), ['--cpus', '0.5']);
  assert.deepEqual(args.slice(args.indexOf('--memory'), args.indexOf('--memory') + 2), ['--memory', '256m']);
  assert.deepEqual(args.slice(args.indexOf('--pids-limit'), args.indexOf('--pids-limit') + 2), ['--pids-limit', '64']);
  assert.deepEqual(args.slice(args.indexOf('--ulimit'), args.indexOf('--ulimit') + 2), ['--ulimit', 'nofile=64:64']);
  assert.equal(args.includes('sh'), false);
  assert.equal(args.includes('-lc'), false);
  assert.deepEqual(args.slice(-4), [
    'python', '-I', '-B', 'tests/visible/score_visible_test.py'
  ]);
});
