import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReadOnlySql } from '../../apps/worker/src/services/sql-runner.mjs';

test('参照専用SELECTとWITHを許可する', () => {
  assert.equal(validateReadOnlySql('SELECT id FROM orders ORDER BY id;').ok, true);
  assert.equal(
    validateReadOnlySql('WITH totals AS (SELECT SUM(amount) AS total FROM orders) SELECT total FROM totals').ok,
    true
  );
});

test('複数文・DDL/DML・接続状態変更SQLを拒否する', () => {
  const rejected = [
    'SELECT 1; DROP TABLE orders;',
    'DELETE FROM orders',
    'WITH target AS (SELECT 1) UPDATE orders SET amount = 0',
    "ATTACH DATABASE '/tmp/x.db' AS external",
    'PRAGMA database_list',
    'VACUUM'
  ];
  for (const sql of rejected) {
    assert.equal(validateReadOnlySql(sql).ok, false, sql);
  }
});

test('文字列リテラル中の禁止語はSQL命令として誤判定しない', () => {
  assert.equal(validateReadOnlySql("SELECT 'delete' AS label FROM orders").ok, true);
});
