import { runFileBackedNodeChallenge } from './file-backed-node-runner.mjs';

const MAX_SQL_BYTES = 32 * 1024;
const DENIED_SQL_TOKENS = /\b(attach|detach|pragma|vacuum|create|alter|drop|insert|update|delete|replace|reindex|analyze|load_extension)\b/i;

const removeCommentsAndStrings = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\r\n]*/g, ' ')
  .replace(/'(?:''|[^'])*'/g, "''");

export const validateReadOnlySql = (code) => {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, reason: 'SQLが空です。' };
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_SQL_BYTES) {
    return { ok: false, reason: 'SQLが長すぎます。' };
  }
  if (code.includes('\0')) {
    return { ok: false, reason: 'SQLに不正な文字が含まれています。' };
  }

  const normalized = removeCommentsAndStrings(code).trim();
  const withoutTrailingSemicolon = normalized.replace(/;\s*$/, '').trim();
  if (withoutTrailingSemicolon.includes(';')) {
    return { ok: false, reason: '複数SQL文は実行できません。' };
  }
  if (!/^(select|with)\b/i.test(withoutTrailingSemicolon)) {
    return { ok: false, reason: '参照専用のSELECT / WITHクエリだけ実行できます。' };
  }
  if (DENIED_SQL_TOKENS.test(withoutTrailingSemicolon)) {
    return { ok: false, reason: 'データや接続状態を変更するSQLは実行できません。' };
  }

  return { ok: true };
};

const invalidSqlResult = (reason) => ({
  status: 'completed',
  score: 0,
  durationMs: 0,
  logs: [`[visible] ${reason}`, '[hidden] hidden tests log is not exposed.'],
  testResults: [
    { testId: 'visible-suite', passed: false, message: 'invalid sql', durationMs: 0, visibility: 'visible' },
    { testId: 'hidden-suite', passed: false, message: 'invalid sql', durationMs: 0, visibility: 'hidden' }
  ],
  artifacts: []
});

export const runSqlChallenge = async (input) => {
  const validation = validateReadOnlySql(input.code);
  if (!validation.ok) return invalidSqlResult(validation.reason);
  return runFileBackedNodeChallenge(input);
};
