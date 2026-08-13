import {
  PUBLIC_RUNNER_LANGUAGES,
  isPublicRunnerLanguage
} from './runner-contract.mjs';

export const RUNNABLE_CHALLENGE_LANGUAGES = PUBLIC_RUNNER_LANGUAGES;

const getSupportedLanguages = (challenge) => {
  const languages = challenge?.supportedLanguages
    ?? challenge?.metadata?.supportedLanguages
    ?? [];
  return Array.isArray(languages) ? languages : [];
};

export const isRunnableChallengeLanguage = (language) => isPublicRunnerLanguage(language);

export const isChallengeRunnable = (challenge) => {
  const languages = getSupportedLanguages(challenge);
  return languages.length > 0
    && languages.every((language) => isRunnableChallengeLanguage(language));
};

export const canSubmitChallengeLanguage = (challenge, language) => {
  if (!isChallengeRunnable(challenge)) return false;
  if (challenge?.runnerConfig && challenge.runnerConfig.networkAccess !== 'disabled') return false;
  return getSupportedLanguages(challenge).includes(language);
};
