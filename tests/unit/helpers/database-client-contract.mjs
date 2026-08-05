import assert from 'node:assert/strict';
import { test } from 'node:test';

export const registerDatabaseClientContract = ({ name, createClient }) => {
  test(`${name}: queryとexecuteを共通結果へ正規化する`, async () => {
    const client = await createClient();
    try {
      await client.execute('CREATE TABLE contract_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      const inserted = await client.execute(
        'INSERT INTO contract_items (id, name) VALUES (?, ?)',
        [1, 'first']
      );
      assert.equal(inserted.rowCount, 1);

      const rows = await client.query('SELECT id, name FROM contract_items WHERE id = ?', [1]);
      assert.deepEqual(rows, [{ id: 1, name: 'first' }]);
    } finally {
      await client.close();
    }
  });

  test(`${name}: transactionをcommitする`, async () => {
    const client = await createClient();
    try {
      await client.execute('CREATE TABLE contract_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      const result = await client.transaction(async (transaction) => {
        await transaction.execute(
          'INSERT INTO contract_items (id, name) VALUES (?, ?)',
          [2, 'committed']
        );
        return 'ok';
      });

      assert.equal(result, 'ok');
      const rows = await client.query('SELECT id, name FROM contract_items WHERE id = ?', [2]);
      assert.deepEqual(rows, [{ id: 2, name: 'committed' }]);
    } finally {
      await client.close();
    }
  });

  test(`${name}: transaction失敗時にrollbackする`, async () => {
    const client = await createClient();
    try {
      await client.execute('CREATE TABLE contract_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      await assert.rejects(
        client.transaction(async (transaction) => {
          await transaction.execute(
            'INSERT INTO contract_items (id, name) VALUES (?, ?)',
            [3, 'rolled-back']
          );
          throw new Error('expected failure');
        }),
        /expected failure/
      );

      const rows = await client.query('SELECT id, name FROM contract_items WHERE id = ?', [3]);
      assert.deepEqual(rows, []);
    } finally {
      await client.close();
    }
  });

  test(`${name}: nested transactionを拒否する`, async () => {
    const client = await createClient();
    try {
      await assert.rejects(
        client.transaction((transaction) => transaction.transaction(async () => {})),
        { name: 'NestedTransactionError' }
      );
    } finally {
      await client.close();
    }
  });

  test(`${name}: closeを冪等にしclose後操作を拒否する`, async () => {
    const client = await createClient();
    await client.close();
    await client.close();
    await assert.rejects(client.query('SELECT 1'), { name: 'DatabaseClientClosedError' });
  });
};
