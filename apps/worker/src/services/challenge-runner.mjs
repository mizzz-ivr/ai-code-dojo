import { getRunnerContract, RUNNER_KINDS } from '../../../../packages/runner-sdk/src/runner-contract.mjs';
import { runFileBackedNodeChallenge } from './file-backed-node-runner.mjs';
import { runHtmlCssChallenge } from './html-css-runner.mjs';
import { runPythonChallengeInContainer } from './python-container-runner.mjs';
import { runSqlChallenge } from './sql-runner.mjs';

const inferLanguage = (challenge) => challenge?.metadata?.supportedLanguages?.[0] ?? null;

export const runChallenge = async ({ challenge, challengeBasePath, code, language = inferLanguage(challenge) }) => {
  const contract = getRunnerContract(language);
  if (!contract) throw new Error('unsupported runner language');

  switch (contract.kind) {
    case RUNNER_KINDS.NODE_TEST:
      return runFileBackedNodeChallenge({ challenge, challengeBasePath, code });
    case RUNNER_KINDS.SQLITE_READONLY:
      return runSqlChallenge({ challenge, challengeBasePath, code });
    case RUNNER_KINDS.HTML_CSS_STATIC:
      return runHtmlCssChallenge({ challenge, challengeBasePath, code });
    case RUNNER_KINDS.PYTHON_CONTAINER:
      return runPythonChallengeInContainer({ challenge, challengeBasePath, code });
    default:
      throw new Error('unsupported runner kind');
  }
};
