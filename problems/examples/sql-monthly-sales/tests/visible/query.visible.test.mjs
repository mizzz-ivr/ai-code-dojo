import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const readQuery = () => readFile(new URL('../../starter/query.sql', import.meta.url), 'utf8');

const seedDatabase = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      amount INTEGER
    );
    INSERT INTO orders (created_at, amount) VALUES
      ('2026-01-05', 1200),
      ('2026-01-20', 800),
      ('2026-02-01', 500),
      ('2026-02-12', NULL),
      ('2026-03-03', 300);
  `);
  return db;
};

test('月ごとの売上合計を昇順で返す', async () => {
  const db = seedDatabase();
  try {
    const rows = db.prepare(await readQuery()).all().map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { month: '2026-01', total_amount: 2000 },
      { month: '2026-02', total_amount: 500 },
      { month: '2026-03', total_amount: 300 }
    ]);
  } finally {
    db.close();
  }
});
