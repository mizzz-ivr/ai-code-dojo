export const RUNNABLE_CHALLENGE_LANGUAGES = Object.freeze(['javascript', 'typescript']);

export const CHALLENGE_CATALOG_OPTIONS = Object.freeze({
  difficulties: Object.freeze(['easy', 'medium', 'hard']),
  categories: Object.freeze(['bugfix', 'feature', 'sql', 'refactor']),
  // Problem schemaや既存contentに他言語が存在しても、現行Workerで採点可能性を
  // integration確認できる言語だけをfilter候補へ出す。
  languages: RUNNABLE_CHALLENGE_LANGUAGES
});

const normalizeKeyword = (value) => String(value ?? '').trim().slice(0, 80);

const normalizeEnum = (value, allowedValues) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : '';
};

export const readChallengeCatalogFilters = (searchParams) => {
  if (!searchParams || typeof searchParams.get !== 'function') {
    throw new TypeError('searchParams must provide get().');
  }

  return Object.freeze({
    keyword: normalizeKeyword(searchParams.get('q')),
    difficulty: normalizeEnum(searchParams.get('difficulty'), CHALLENGE_CATALOG_OPTIONS.difficulties),
    category: normalizeEnum(searchParams.get('category'), CHALLENGE_CATALOG_OPTIONS.categories),
    language: normalizeEnum(searchParams.get('language'), CHALLENGE_CATALOG_OPTIONS.languages)
  });
};

export const isChallengeRunnable = (challenge) => {
  const languages = challenge?.supportedLanguages ?? challenge?.metadata?.supportedLanguages ?? [];
  return Array.isArray(languages)
    && languages.length > 0
    && languages.every((language) => RUNNABLE_CHALLENGE_LANGUAGES.includes(language));
};

const includesKeyword = (challenge, keyword) => {
  if (!keyword) return true;
  const normalizedKeyword = keyword.toLocaleLowerCase('ja-JP');
  const searchable = [challenge?.title, challenge?.slug]
    .map((value) => String(value ?? '').toLocaleLowerCase('ja-JP'))
    .join('\n');
  return searchable.includes(normalizedKeyword);
};

export const filterChallenges = (challenges, filters) => {
  if (!Array.isArray(challenges)) return [];

  return challenges.filter((challenge) => {
    if (!includesKeyword(challenge, filters.keyword)) return false;
    if (filters.difficulty && challenge?.difficulty !== filters.difficulty) return false;
    if (filters.category && challenge?.category !== filters.category) return false;
    if (filters.language && !(challenge?.supportedLanguages ?? []).includes(filters.language)) return false;
    return true;
  });
};
