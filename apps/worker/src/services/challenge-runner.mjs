import { getRunnerContract, RUNNER_KINDS } from '../../../../packages/runner-sdk/src/runner-contract.mjs';
import { runFileBackedNodeChallenge } from './file-backed-node-runner.mjs';
import { runHtmlCssChallenge } from './html-css-runner.mjs';
import { runPythonChallengeRemotely } from './python-remote-runner-client.mjs';
import { runSqlChallenge } from './sql-runner.mjs';

const inferLanguage = (challenge) => challenge?.metadata?.supportedLanguages?.[0] ?? null;

export const runChallenge = async ({
  challenge,
  challengeBasePath,
  code,
  language = inferLanguage(challenge),
  jobContext
}) => {
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
      return runPythonChallengeRemotely({ challenge, code, jobContext });
    default:
      throw new Error('unsupported runner kind');
  }
};
