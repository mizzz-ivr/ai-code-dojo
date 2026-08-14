import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runPythonCaseChallenge } from '../../apps/python-runner/src/services/python-case-runner.mjs';

const enabled = process.env.RUNNER_PYTHON_CONTAINER_CONTRACT === '1';

const solution = `def classify_score(score: int) -> str:
    if score < 0 or score > 100:
        raise ValueError("score must be between 0 and 100")
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 60:
        return "C"
    return "D"
`;

const filesystemProbeSolution = `import os

def classify_score(score: int) -> str:
    for root, dirs, files in os.walk("/workspace"):
        names = [*dirs, *files]
        if any("hidden" in name.lower() or "test" in name.lower() or "case" in name.lower() for name in names):
            return "LEAKED"
    if score < 0 or score > 100:
        raise ValueError("score must be between 0 and 100")
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 60:
        return "C"
    return "D"
`;

const syntaxErrorSubmission = `def classify_score(score):
    return (
`;

const timeoutSubmission = `while True:
    pass

def classify_score(score):
    return "A"
`;

const loadChallenge = async () => {
  const challengeBasePath = path.resolve('problems/examples/python-bugfix-score-buckets');
  const challenge = JSON.parse(await readFile(path.join(challengeBasePath, 'problem.json'), 'utf8'));
  return { challengeBasePath, challenge };
};

test('Python隔離Runnerでstarter failure / reference solution successを確認する', { skip: !enabled }, async () => {
  const { challengeBasePath, challenge } = await loadChallenge();
  const starter = await readFile(path.join(challengeBasePath, 'starter/score.py'), 'utf8');

  const starterResult = await runPythonCaseChallenge({ challenge, challengeBasePath, code: starter });
  assert.notEqual(starterResult.score, 100);

  const solvedResult = await runPythonCaseChallenge({ challenge, challengeBasePath, code: solution });
  assert.equal(solvedResult.score, 100);
  assert.equal(solvedResult.testResults.every((result) => result.passed), true);
  assert.equal(solvedResult.logs.some((log) => log.includes('hidden test source and logs are not exposed')), true);
});

test('submitted codeからhidden test filesystemを参照できない', { skip: !enabled }, async () => {
  const { challengeBasePath, challenge } = await loadChallenge();
  const result = await runPythonCaseChallenge({ challenge, challengeBasePath, code: filesystemProbeSolution });

  assert.equal(result.score, 100);
  assert.equal(result.logs.some((log) => /score_hidden|hidden_cases|expected/i.test(log)), false);
});

test('SyntaxErrorとtimeoutはinfra retryではなくterminal grading failureとして返す', { skip: !enabled }, async () => {
  const { challengeBasePath, challenge } = await loadChallenge();

  const syntaxResult = await runPythonCaseChallenge({ challenge, challengeBasePath, code: syntaxErrorSubmission });
  assert.equal(syntaxResult.status, 'completed');
  assert.equal(syntaxResult.score, 0);

  const shortTimeoutChallenge = {
    ...challenge,
    runnerConfig: { ...challenge.runnerConfig, timeoutSeconds: 0.2 }
  };
  const timeoutResult = await runPythonCaseChallenge({
    challenge: shortTimeoutChallenge,
    challengeBasePath,
    code: timeoutSubmission
  });
  assert.equal(timeoutResult.status, 'completed');
  assert.equal(timeoutResult.score, 0);
});
