import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PYTHON_RUNNER_TRIVY_IGNORE_PATH = path.resolve(process.cwd(), '.trivyignore.yaml');

const EXPECTED_IDS = Object.freeze([
  'CVE-2026-33818',
  'CVE-2026-39821',
  'CVE-2026-46600',
  'CVE-2026-56853',
  'CVE-2026-56858',
  'CVE-2026-56859',
  'CVE-2026-56860',
  'CVE-2026-56862'
]);
const EXPECTED_PATH = 'usr/local/bin/docker';
const EXPECTED_PURL = 'pkg:golang/stdlib@v1.26.5';
const EXPECTED_EXPIRY = '2026-09-17';
const EXPECTED_STATEMENT = 'Docker CLI 29.6.2 is the latest stable release and Go 1.26.6 is not released yet; re-evaluate on expiry.';

const ENTRY_PATTERN = /  - id: ([^\n]+)\n    paths:\n      - ([^\n]+)\n    purls:\n      - ([^\n]+)\n    expired_at: ([^\n]+)\n    statement: ([^\n]+)\n/g;

export const validatePythonRunnerTrivyExceptions = (source) => {
  const errors = [];
  if (typeof source !== 'string') return ['Trivy ignore source must be text.'];
  if (source.includes('\t')) errors.push('Trivy ignore file must not contain tabs.');

  const entries = [];
  let match;
  while ((match = ENTRY_PATTERN.exec(source)) !== null) {
    entries.push({ id: match[1], path: match[2], purl: match[3], expiry: match[4], statement: match[5] });
  }

  const remainder = source.replace(ENTRY_PATTERN, '').trim();
  if (remainder !== 'vulnerabilities:') {
    errors.push('Trivy ignore file must contain only the approved vulnerability entries.');
  }
  if (entries.length !== EXPECTED_IDS.length) {
    errors.push(`Trivy ignore file must contain exactly ${EXPECTED_IDS.length} entries.`);
  }

  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) errors.push('Trivy ignore vulnerability IDs must be unique.');
  if (JSON.stringify([...ids].sort()) !== JSON.stringify([...EXPECTED_IDS].sort())) {
    errors.push('Trivy ignore vulnerability IDs must match the approved Docker CLI exception set.');
  }

  for (const entry of entries) {
    if (entry.path !== EXPECTED_PATH) errors.push(`${entry.id}: path must be ${EXPECTED_PATH}.`);
    if (entry.purl !== EXPECTED_PURL) errors.push(`${entry.id}: purl must be ${EXPECTED_PURL}.`);
    if (entry.expiry !== EXPECTED_EXPIRY) errors.push(`${entry.id}: expiry must remain ${EXPECTED_EXPIRY}.`);
    if (entry.statement !== EXPECTED_STATEMENT) errors.push(`${entry.id}: statement must document the approved upstream exception.`);
  }
  return errors;
};

export const loadPythonRunnerTrivyExceptions = async (filePath = PYTHON_RUNNER_TRIVY_IGNORE_PATH) => readFile(filePath, 'utf8');

export const assertValidPythonRunnerTrivyExceptions = (source) => {
  const errors = validatePythonRunnerTrivyExceptions(source);
  if (errors.length > 0) {
    throw new Error(`Python Runner Trivy exception validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return true;
};
