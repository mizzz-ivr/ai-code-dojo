export const RUNNABLE_CHALLENGE_LANGUAGES = Object.freeze([
  'javascript',
  'typescript'
]);

const getSupportedLanguages = (challenge) => {
  const languages = challenge?.supportedLanguages
    ?? challenge?.metadata?.supportedLanguages
    ?? [];
  return Array.isArray(languages) ? languages : [];
};

export const isRunnableChallengeLanguage = (language) =>
  typeof language === 'string'
  && RUNNABLE_CHALLENGE_LANGUAGES.includes(language);

export const isChallengeRunnable = (challenge) => {
  const languages = getSupportedLanguages(challenge);
  return languages.length > 0
    && languages.every((language) => isRunnableChallengeLanguage(language));
};

export const canSubmitChallengeLanguage = (challenge, language) => {
  if (!isChallengeRunnable(challenge)) return false;
  return getSupportedLanguages(challenge).includes(language);
};
