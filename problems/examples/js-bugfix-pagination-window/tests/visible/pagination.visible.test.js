import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageWindow } from '../../starter/pagination.js';

test('中央ページではcurrentPageを中心に5件返す', () => {
  assert.deepEqual(buildPageWindow(5, 10, 5), [3, 4, 5, 6, 7]);
});
