import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runPythonChallengeInContainer } from '../../apps/worker/src/services/python-container-runner.mjs';

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

test('Python隔離Runnerでstarter failure / reference solution successを確認する', { skip: !enabled }, async () => {
  const challengeBasePath = path.resolve('problems/examples/python-bugfix-score-buckets');
  const challenge = JSON.parse(await readFile(path.join(challengeBasePath, 'problem.json'), 'utf8'));
  const starter = await readFile(path.join(challengeBasePath, 'starter/score.py'), 'utf8');

  const starterResult = await runPythonChallengeInContainer({
    challenge,
    challengeBasePath,
    code: starter
  });
  assert.notEqual(starterResult.score, 100);

  const solvedResult = await runPythonChallengeInContainer({
    challenge,
    challengeBasePath,
    code: solution
  });
  assert.equal(solvedResult.score, 100);
  assert.equal(solvedResult.testResults.every((result) => result.passed), true);
  assert.equal(solvedResult.logs.some((log) => log.includes('hidden tests log is not exposed')), true);
});
