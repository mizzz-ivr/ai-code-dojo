import {
  assertSql,
  createLifecycleGuard,
  createTransactionClient,
  normalizeParameters
} from './database-client-contract.mjs';

const normalizeRows = (rows) => rows.map((row) => ({ ...row }));

const normalizeExecuteResult = (result) => ({
  rowCount: Number(result?.changes ?? 0),
  lastInsertId: result?.lastInsertRowid ?? null
});

export const createSqliteDatabaseClient = ({ database, closeDatabase = true }) => {
  if (!database || typeof database.prepare !== 'function' || typeof database.exec !== 'function') {
    throw new TypeError('database must provide prepare() and exec().');
  }

  const lifecycle = createLifecycleGuard();
  let transactionActive = false;

  const assertNoActiveTransaction = () => {
    if (transactionActive) {
      throw new Error('SQLite database transaction is active. Use the transaction client.');
    }
  };

  const queryOnConnection = async (sql, parameters = []) => {
    lifecycle.assertOpen();
    assertSql(sql);
    const values = normalizeParameters(parameters);
    return normalizeRows(database.prepare(sql).all(...values));
  };

  const executeOnConnection = async (sql, parameters = []) => {
    lifecycle.assertOpen();
    assertSql(sql);
    const values = normalizeParameters(parameters);
    return normalizeExecuteResult(database.prepare(sql).run(...values));
  };

  const query = async (sql, parameters = []) => {
    assertNoActiveTransaction();
    return queryOnConnection(sql, parameters);
  };

  const execute = async (sql, parameters = []) => {
    assertNoActiveTransaction();
    return executeOnConnection(sql, parameters);
  };

  const transaction = async (operation) => {
    lifecycle.assertOpen();
    if (typeof operation !== 'function') {
      throw new TypeError('transaction operation must be a function.');
    }
    if (transactionActive) {
      return createTransactionClient({ query: queryOnConnection, execute: executeOnConnection }).transaction(operation);
    }

    transactionActive = true;
    database.exec('BEGIN IMMEDIATE');
    const transactionClient = createTransactionClient({
      query: queryOnConnection,
      execute: executeOnConnection
    });

    try {
      const result = await operation(transactionClient);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Rollback failure must not hide the original error.
      }
      throw error;
    } finally {
      transactionActive = false;
    }
  };

  const close = async () => {
    assertNoActiveTransaction();
    if (!lifecycle.close()) return;
    if (closeDatabase && typeof database.close === 'function') {
      database.close();
    }
  };

  return Object.freeze({ query, execute, transaction, close });
};
