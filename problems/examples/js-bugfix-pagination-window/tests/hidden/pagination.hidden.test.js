import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageWindow } from '../../starter/pagination.js';

test('先頭では1から5まで返す', () => {
  assert.deepEqual(buildPageWindow(1, 10, 5), [1, 2, 3, 4, 5]);
});

test('末尾では6から10まで返す', () => {
  assert.deepEqual(buildPageWindow(10, 10, 5), [6, 7, 8, 9, 10]);
});

test('totalPagesがmaxItems未満なら全ページを返す', () => {
  assert.deepEqual(buildPageWindow(2, 3, 5), [1, 2, 3]);
});

test('currentPageを有効範囲へclampする', () => {
  assert.deepEqual(buildPageWindow(0, 8, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(buildPageWindow(99, 8, 5), [4, 5, 6, 7, 8]);
});
