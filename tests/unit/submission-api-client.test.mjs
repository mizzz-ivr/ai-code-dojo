import test from 'node:test';
import assert from 'node:assert/strict';
import { submitChallengeToApi } from '../../apps/web/src/submission-api-client.mjs';

const payload = {
  challengeSlug: 'js-bugfix-add',
  language: 'javascript',
  code: 'export function sum() {}'
};

const jsonResponse = ({ ok, status, body }) => ({
  ok,
  status,
  json: async () => body
});

test('201応答ではsubmission idを返す', async () => {
  const result = await submitChallengeToApi({
    apiBaseUrl: 'http://api.example',
    payload,
    fetchImpl: async () => jsonResponse({ ok: true, status: 201, body: { id: 'submission-1' } })
  });

  assert.deepEqual(result, { ok: true, id: 'submission-1' });
});

test('APIの400/404エラーはredirect用idにせず表示可能なerrorとして返す', async () => {
  const result = await submitChallengeToApi({
    apiBaseUrl: 'http://api.example',
    payload,
    fetchImpl: async () => jsonResponse({
      ok: false,
      status: 400,
      body: { error: 'このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。' }
    })
  });

  assert.deepEqual(result, {
    ok: false,
    statusCode: 400,
    error: 'このchallengeと言語の組み合わせは現在の採点Runnerでは利用できません。'
  });
});

test('成功statusでもidがない応答は502扱いにする', async () => {
  const result = await submitChallengeToApi({
    apiBaseUrl: 'http://api.example',
    payload,
    fetchImpl: async () => jsonResponse({ ok: true, status: 201, body: {} })
  });

  assert.deepEqual(result, {
    ok: false,
    statusCode: 502,
    error: '提出APIの応答が不正です。時間をおいて再試行してください。'
  });
});

test('API通信失敗は502の安全なメッセージへ変換する', async () => {
  const result = await submitChallengeToApi({
    apiBaseUrl: 'http://api.example',
    payload,
    fetchImpl: async () => { throw new Error('connection refused'); }
  });

  assert.deepEqual(result, {
    ok: false,
    statusCode: 502,
    error: '提出APIに接続できませんでした。時間をおいて再試行してください。'
  });
});

test('API error文字列は空値を避け長さを制限する', async () => {
  const longError = 'x'.repeat(500);
  const result = await submitChallengeToApi({
    apiBaseUrl: 'http://api.example',
    payload,
    fetchImpl: async () => jsonResponse({ ok: false, status: 409, body: { error: longError } })
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 409);
  assert.equal(result.error.length, 240);
});
