import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runPythonInvocationBatchInContainer } from './python-invocation-container.mjs';

const CASE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const FUNCTION_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const resolveChallengePath = (challengeBasePath, relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('python test case path is invalid');
  }
  const root = path.resolve(challengeBasePath);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('python test case path escapes challenge');
  }
  return resolved;
};

const validateCase = (testCase) => {
  if (!testCase || typeof testCase !== 'object') throw new Error('python test case is invalid');
  if (typeof testCase.id !== 'string' || !CASE_ID_PATTERN.test(testCase.id)) throw new Error('python test case id is invalid');
  if (typeof testCase.function !== 'string' || !FUNCTION_PATTERN.test(testCase.function)) throw new Error('python test case function is invalid');
  const args = testCase.args ?? [];
  const kwargs = testCase.kwargs ?? {};
  if (!Array.isArray(args) || !kwargs || typeof kwargs !== 'object' || Array.isArray(kwargs)) {
    throw new Error('python test case arguments are invalid');
  }
  const hasExpected = Object.hasOwn(testCase, 'expected');
  const hasExpectedError = Object.hasOwn(testCase, 'expectedError');
  if (hasExpected === hasExpectedError) throw new Error('python test case expectation is invalid');
  if (hasExpectedError && (typeof testCase.expectedError !== 'string' || !FUNCTION_PATTERN.test(testCase.expectedError))) {
    throw new Error('python expected error type is invalid');
  }
  JSON.stringify({ args, kwargs, expected: testCase.expected });
  return Object.freeze({
    id: testCase.id,
    function: testCase.function,
    args,
    kwargs,
    ...(hasExpected ? { expected: testCase.expected } : { expectedError: testCase.expectedError })
  });
};

const readCaseFiles = async ({ challengeBasePath, testPaths }) => {
  if (!Array.isArray(testPaths) || testPaths.length === 0) throw new Error('python test case files are required');
  const cases = [];
  for (const testPath of testPaths) {
    const raw = await readFile(resolveChallengePath(challengeBasePath, testPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.cases) || parsed.cases.length === 0) throw new Error('python test case file is invalid');
    cases.push(...parsed.cases.map(validateCase));
  }
  if (cases.length > 64) throw new Error('python test case count exceeds limit');
  const ids = new Set();
  for (const testCase of cases) {
    if (ids.has(testCase.id)) throw new Error('python test case id must be unique');
    ids.add(testCase.id);
  }
  return cases;
};

const runSuite = async ({ code, cases, timeoutMs, visibility, runBatch }) => {
  const calls = cases.map((testCase) => ({
    id: testCase.id,
    function: testCase.function,
    args: testCase.args,
    kwargs: testCase.kwargs
  }));
  const run = await runBatch({ code, calls, timeoutMs });
  const byId = new Map(run.results.map((result) => [result.id, result]));
  let passedCount = 0;

  for (const testCase of cases) {
    const actual = byId.get(testCase.id);
    const passed = Object.hasOwn(testCase, 'expectedError')
      ? actual?.ok === false && actual?.errorType === testCase.expectedError
      : actual?.ok === true && isDeepStrictEqual(actual?.value, testCase.expected);
    if (passed) passedCount += 1;
  }

  return {
    totalCount: cases.length,
    passedCount,
    result: {
      testId: `${visibility}-suite`,
      passed: passedCount === cases.length,
      message: passedCount === cases.length ? 'ok' : 'failed',
      durationMs: 0,
      visibility
    }
  };
};

export const runPythonCaseChallenge = async ({
  challenge,
  challengeBasePath,
  code,
  runBatch = runPythonInvocationBatchInContainer
}) => {
  if (!challenge || challenge?.metadata?.supportedLanguages?.includes('python') !== true) {
    throw new Error('python challenge is invalid');
  }
  if (challenge?.runnerConfig?.networkAccess !== 'disabled') {
    throw new Error('python challenge must disable network access');
  }

  const startedAt = Date.now();
  const timeoutMs = Number(challenge.runnerConfig.timeoutSeconds) * 1000;
  const visibleCases = await readCaseFiles({ challengeBasePath, testPaths: challenge.visibleTests });
  const hiddenCases = await readCaseFiles({ challengeBasePath, testPaths: challenge.hiddenTests });

  const visibleRun = await runSuite({ code, cases: visibleCases, timeoutMs, visibility: 'visible', runBatch });
  const hiddenRun = await runSuite({ code, cases: hiddenCases, timeoutMs, visibility: 'hidden', runBatch });
  const passedCount = visibleRun.passedCount + hiddenRun.passedCount;
  const totalCount = visibleRun.totalCount + hiddenRun.totalCount;

  return {
    status: 'completed',
    score: Math.round((passedCount / totalCount) * 100),
    durationMs: Date.now() - startedAt,
    logs: [
      `[visible] ${visibleRun.passedCount}/${visibleRun.totalCount} cases passed.`,
      '[hidden] hidden test source and logs are not exposed.'
    ],
    testResults: [visibleRun.result, hiddenRun.result],
    artifacts: []
  };
};
