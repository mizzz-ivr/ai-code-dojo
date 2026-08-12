import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const readQuery = () => readFile(new URL('../../starter/query.sql', import.meta.url), 'utf8');

test('月境界とNULLを含むデータでも集計順序を維持する', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        amount INTEGER
      );
      INSERT INTO orders (created_at, amount) VALUES
        ('2025-12-31', 10),
        ('2026-01-01', NULL),
        ('2026-01-15', 40),
        ('2026-01-31', 60),
        ('2026-10-01', 25),
        ('2026-10-31', 75);
    `);
    const rows = db.prepare(await readQuery()).all().map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { month: '2025-12', total_amount: 10 },
      { month: '2026-01', total_amount: 100 },
      { month: '2026-10', total_amount: 100 }
    ]);
  } finally {
    db.close();
  }
});
