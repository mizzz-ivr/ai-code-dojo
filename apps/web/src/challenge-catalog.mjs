export const CHALLENGE_CATALOG_OPTIONS = Object.freeze({
  difficulties: Object.freeze(['easy', 'medium', 'hard']),
  categories: Object.freeze(['bugfix', 'feature', 'sql', 'refactor']),
  // Problem schema上はpython/html-cssも予約済みだが、現行Workerで採点可能な言語だけを公開UIへ出す。
  languages: Object.freeze(['javascript', 'typescript', 'sql'])
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
