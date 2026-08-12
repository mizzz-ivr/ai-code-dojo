import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_RUNNER_LANGUAGES,
  RUNNER_KINDS,
  getRunnerContract,
  isPublicRunnerLanguage,
  requiresContainerRunner
} from '../../packages/runner-sdk/src/runner-contract.mjs';
import {
  canSubmitChallengeLanguage,
  isRunnableChallengeLanguage
} from '../../packages/runner-sdk/src/language-policy.mjs';

test('公開Runner言語と隔離preview言語を分離する', () => {
  assert.deepEqual(PUBLIC_RUNNER_LANGUAGES, ['javascript', 'typescript', 'sql', 'html-css']);
  assert.equal(isPublicRunnerLanguage('sql'), true);
  assert.equal(isPublicRunnerLanguage('html-css'), true);
  assert.equal(isPublicRunnerLanguage('python'), false);
  assert.equal(isRunnableChallengeLanguage('python'), false);
});

test('言語ごとに固定Runner kindを返す', () => {
  assert.equal(getRunnerContract('javascript').kind, RUNNER_KINDS.NODE_TEST);
  assert.equal(getRunnerContract('typescript').kind, RUNNER_KINDS.NODE_TEST);
  assert.equal(getRunnerContract('sql').kind, RUNNER_KINDS.SQLITE_READONLY);
  assert.equal(getRunnerContract('html-css').kind, RUNNER_KINDS.HTML_CSS_STATIC);
  assert.equal(getRunnerContract('python').kind, RUNNER_KINDS.PYTHON_CONTAINER);
  assert.equal(requiresContainerRunner('python'), true);
  assert.equal(getRunnerContract('ruby'), null);
});

test('公開言語でもnetworkAccessがdisabledでなければ提出を拒否する', () => {
  const sqlChallenge = {
    metadata: { supportedLanguages: ['sql'] },
    runnerConfig: { networkAccess: 'disabled' }
  };
  assert.equal(canSubmitChallengeLanguage(sqlChallenge, 'sql'), true);
  assert.equal(
    canSubmitChallengeLanguage({ ...sqlChallenge, runnerConfig: { networkAccess: 'enabled' } }, 'sql'),
    false
  );
});
