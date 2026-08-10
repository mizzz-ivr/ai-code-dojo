import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOrders } from '../../starter/order-summary.js';

test('paidとpendingを集計する', () => {
  const summary = summarizeOrders([
    { id: 'b', status: 'paid', amount: 1200 },
    { id: 'a', status: 'pending', amount: 900 },
    { id: 'c', status: 'paid', amount: 800 }
  ]);

  assert.deepEqual(summary, { paidCount: 2, pendingCount: 1, totalPaidAmount: 2000 });
});
