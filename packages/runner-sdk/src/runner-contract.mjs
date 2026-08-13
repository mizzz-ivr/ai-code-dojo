export const RUNNER_KINDS = Object.freeze({
  NODE_TEST: 'node-test',
  SQLITE_READONLY: 'sqlite-readonly',
  HTML_CSS_STATIC: 'html-css-static',
  PYTHON_CONTAINER: 'python-container'
});

const RUNNER_CONTRACTS = Object.freeze({
  javascript: Object.freeze({ kind: RUNNER_KINDS.NODE_TEST, availability: 'public' }),
  typescript: Object.freeze({ kind: RUNNER_KINDS.NODE_TEST, availability: 'public' }),
  sql: Object.freeze({ kind: RUNNER_KINDS.SQLITE_READONLY, availability: 'public' }),
  'html-css': Object.freeze({ kind: RUNNER_KINDS.HTML_CSS_STATIC, availability: 'public' }),
  python: Object.freeze({ kind: RUNNER_KINDS.PYTHON_CONTAINER, availability: 'isolated-preview' })
});

export const PUBLIC_RUNNER_LANGUAGES = Object.freeze(
  Object.entries(RUNNER_CONTRACTS)
    .filter(([, contract]) => contract.availability === 'public')
    .map(([language]) => language)
);

export const getRunnerContract = (language) =>
  typeof language === 'string' ? RUNNER_CONTRACTS[language] ?? null : null;

export const isPublicRunnerLanguage = (language) =>
  getRunnerContract(language)?.availability === 'public';

export const requiresContainerRunner = (language) =>
  getRunnerContract(language)?.kind === RUNNER_KINDS.PYTHON_CONTAINER;
