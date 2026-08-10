import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOrders } from '../../starter/order-summary.js';

test('入力配列の順序を変更しない', () => {
  const orders = [
    { id: 'b', status: 'paid', amount: 100 },
    { id: 'a', status: 'cancelled', amount: 999 },
    { id: 'c', status: 'pending', amount: 300 }
  ];
  const before = structuredClone(orders);

  const summary = summarizeOrders(orders);

  assert.deepEqual(summary, { paidCount: 1, pendingCount: 1, totalPaidAmount: 100 });
  assert.deepEqual(orders, before);
});

test('空配列では0件のsummaryを返す', () => {
  assert.deepEqual(summarizeOrders([]), { paidCount: 0, pendingCount: 0, totalPaidAmount: 0 });
});
