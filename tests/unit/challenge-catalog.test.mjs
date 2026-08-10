import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGE_CATALOG_OPTIONS,
  filterChallenges,
  isChallengeRunnable,
  readChallengeCatalogFilters
} from '../../apps/web/src/challenge-catalog.mjs';

const challenges = [
  { slug: 'js-bugfix-add', title: '合計関数のバグ修正', difficulty: 'easy', category: 'bugfix', supportedLanguages: ['javascript'] },
  { slug: 'ts-feature-user-display', title: 'ユーザー表示名の機能追加', difficulty: 'easy', category: 'feature', supportedLanguages: ['typescript'] },
  { slug: 'sql-monthly-sales', title: '月次売上集計クエリ', difficulty: 'medium', category: 'sql', supportedLanguages: ['sql'] }
];

test('catalog filterをquery stringから正規化する', () => {
  const filters = readChallengeCatalogFilters(new URLSearchParams('q=%20USER%20&difficulty=EASY&category=feature&language=typescript'));
  assert.deepEqual(filters, {
    keyword: 'USER',
    difficulty: 'easy',
    category: 'feature',
    language: 'typescript'
  });
});

test('公開言語filterは現行Workerで採点確認済みのJS/TSに限定する', () => {
  assert.deepEqual(CHALLENGE_CATALOG_OPTIONS.languages, ['javascript', 'typescript']);
  assert.equal(readChallengeCatalogFilters(new URLSearchParams('language=python')).language, '');
  assert.equal(readChallengeCatalogFilters(new URLSearchParams('language=sql')).language, '');
});

test('Challengeの採点可否を言語からfail-closed判定する', () => {
  assert.equal(isChallengeRunnable(challenges[0]), true);
  assert.equal(isChallengeRunnable(challenges[1]), true);
  assert.equal(isChallengeRunnable(challenges[2]), false);
  assert.equal(isChallengeRunnable({ metadata: { supportedLanguages: ['typescript'] } }), true);
  assert.equal(isChallengeRunnable({ supportedLanguages: ['javascript', 'sql'] }), false);
  assert.equal(isChallengeRunnable({ supportedLanguages: [] }), false);
});

test('未知のenum filterは無効化して500要因にしない', () => {
  const filters = readChallengeCatalogFilters(new URLSearchParams('difficulty=<script>&category=unknown&language=ruby'));
  assert.deepEqual(filters, {
    keyword: '',
    difficulty: '',
    category: '',
    language: ''
  });
});

test('keywordはtitleとslugを大文字小文字を無視して検索する', () => {
  const byTitle = filterChallenges(challenges, { keyword: 'ユーザー', difficulty: '', category: '', language: '' });
  assert.deepEqual(byTitle.map((item) => item.slug), ['ts-feature-user-display']);

  const bySlug = filterChallenges(challenges, { keyword: 'MONTHLY', difficulty: '', category: '', language: '' });
  assert.deepEqual(bySlug.map((item) => item.slug), ['sql-monthly-sales']);
});

test('difficulty・category・languageを複合条件で絞り込む', () => {
  const filtered = filterChallenges(challenges, {
    keyword: '',
    difficulty: 'easy',
    category: 'feature',
    language: 'typescript'
  });
  assert.deepEqual(filtered.map((item) => item.slug), ['ts-feature-user-display']);
});

test('一致しない条件では空配列を返し入力配列を変更しない', () => {
  const before = structuredClone(challenges);
  const filtered = filterChallenges(challenges, { keyword: '', difficulty: 'hard', category: '', language: '' });
  assert.deepEqual(filtered, []);
  assert.deepEqual(challenges, before);
});
