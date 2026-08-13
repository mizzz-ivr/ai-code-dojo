import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTrustedNodeTests } from './trusted-node-test-runner.mjs';

const resolveWorkspacePath = (workingDirectory, relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('challenge file path is invalid');
  }
  const resolved = path.resolve(workingDirectory, relativePath);
  const root = `${path.resolve(workingDirectory)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('challenge file path escapes workspace');
  return resolved;
};

const validateTestPaths = (workingDirectory, tests) => {
  if (!Array.isArray(tests) || tests.length === 0) throw new Error('challenge tests are required');
  return tests.map((testPath) => {
    resolveWorkspacePath(workingDirectory, testPath);
    return testPath;
  });
};

export const runFileBackedNodeChallenge = async ({ challenge, challengeBasePath, code }) => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-dojo-run-'));
  const workingDirectory = path.join(tmpRoot, challenge.metadata.slug);
  const startedAt = Date.now();

  try {
    await cp(challengeBasePath, workingDirectory, { recursive: true });
    const editableStarter = challenge.starterCode.find((file) => !file.readonly);
    if (!editableStarter) throw new Error('editable starter file is required');
    await writeFile(resolveWorkspacePath(workingDirectory, editableStarter.path), code, 'utf8');

    const timeoutMs = challenge.runnerConfig.timeoutSeconds * 1000;
    const visibleTests = validateTestPaths(workingDirectory, challenge.visibleTests);
    const hiddenTests = validateTestPaths(workingDirectory, challenge.hiddenTests);
    const visibleRun = await runTrustedNodeTests({
      cwd: workingDirectory,
      tests: visibleTests,
      timeoutMs,
      visibility: 'visible'
    });
    const hiddenRun = await runTrustedNodeTests({
      cwd: workingDirectory,
      tests: hiddenTests,
      timeoutMs,
      visibility: 'hidden'
    });

    const testResults = [visibleRun.result, hiddenRun.result];
    const passedCount = testResults.filter((test) => test.passed).length;
    return {
      status: 'completed',
      score: Math.round((passedCount / testResults.length) * 100),
      durationMs: Date.now() - startedAt,
      logs: [
        `[visible] ${visibleRun.output}`,
        '[hidden] hidden tests log is not exposed.'
      ],
      testResults,
      artifacts: []
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
};
