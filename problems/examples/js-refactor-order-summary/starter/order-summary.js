export function summarizeOrders(orders) {
  orders.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return orders.reduce((summary, order) => {
    if (order.status === 'paid') {
      summary.paidCount += 1;
      summary.totalPaidAmount += order.amount;
    } else if (order.status === 'pending') {
      summary.pendingCount += 1;
    }
    return summary;
  }, { paidCount: 0, pendingCount: 0, totalPaidAmount: 0 });
}
