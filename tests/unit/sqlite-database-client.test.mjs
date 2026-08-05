import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createSqliteDatabaseClient } from '../../apps/api/src/db/adapters/sqlite-database-client.mjs';
import { registerDatabaseClientContract } from './helpers/database-client-contract.mjs';

registerDatabaseClientContract({
  name: 'SQLite database client',
  createClient: async () => createSqliteDatabaseClient({
    database: new DatabaseSync(':memory:')
  })
});

test('SQLite transaction中は外側のquery・execute・closeを拒否する', async () => {
  const client = createSqliteDatabaseClient({
    database: new DatabaseSync(':memory:')
  });
  await client.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

  let releaseTransaction;
  const transactionGate = new Promise((resolve) => {
    releaseTransaction = resolve;
  });
  let markTransactionStarted;
  const transactionStarted = new Promise((resolve) => {
    markTransactionStarted = resolve;
  });

  const transactionPromise = client.transaction(async (transactionClient) => {
    await transactionClient.execute('INSERT INTO items (id, name) VALUES (?, ?)', [1, 'inside']);
    markTransactionStarted();
    await transactionGate;
  });

  await transactionStarted;

  try {
    await assert.rejects(
      client.query('SELECT id, name FROM items'),
      /SQLite database transaction is active/
    );
    await assert.rejects(
      client.execute('INSERT INTO items (id, name) VALUES (?, ?)', [2, 'outside']),
      /SQLite database transaction is active/
    );
    await assert.rejects(
      client.close(),
      /SQLite database transaction is active/
    );
  } finally {
    releaseTransaction();
  }

  await transactionPromise;
  assert.deepEqual(
    await client.query('SELECT id, name FROM items ORDER BY id'),
    [{ id: 1, name: 'inside' }]
  );
  await client.close();
});
