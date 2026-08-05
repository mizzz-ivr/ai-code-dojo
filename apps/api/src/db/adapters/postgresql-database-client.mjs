import {
  assertSql,
  createLifecycleGuard,
  createTransactionClient,
  normalizeParameters
} from './database-client-contract.mjs';
import { toPostgresqlPlaceholders } from './postgresql-placeholders.mjs';

const normalizeResult = (result) => ({
  rows: Array.isArray(result?.rows) ? result.rows : [],
  rowCount: Number(result?.rowCount ?? 0)
});

const runQuery = async (driver, sql, parameters) => {
  assertSql(sql);
  const values = normalizeParameters(parameters);
  return normalizeResult(await driver.query(toPostgresqlPlaceholders(sql), values));
};

export const createPostgresqlDatabaseClient = ({ pool }) => {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('pool must provide query() and connect().');
  }

  const lifecycle = createLifecycleGuard();

  const query = async (sql, parameters = []) => {
    lifecycle.assertOpen();
    const result = await runQuery(pool, sql, parameters);
    return result.rows;
  };

  const execute = async (sql, parameters = []) => {
    lifecycle.assertOpen();
    const result = await runQuery(pool, sql, parameters);
    return { rowCount: result.rowCount, lastInsertId: null };
  };

  const transaction = async (operation) => {
    lifecycle.assertOpen();
    if (typeof operation !== 'function') {
      throw new TypeError('transaction operation must be a function.');
    }

    const connection = await pool.connect();
    if (!connection || typeof connection.query !== 'function' || typeof connection.release !== 'function') {
      throw new TypeError('pool.connect() must return query() and release().');
    }

    const transactionQuery = async (sql, parameters = []) => {
      lifecycle.assertOpen();
      const result = await runQuery(connection, sql, parameters);
      return result.rows;
    };

    const transactionExecute = async (sql, parameters = []) => {
      lifecycle.assertOpen();
      const result = await runQuery(connection, sql, parameters);
      return { rowCount: result.rowCount, lastInsertId: null };
    };

    try {
      await connection.query('BEGIN');
      const result = await operation(createTransactionClient({
        query: transactionQuery,
        execute: transactionExecute
      }));
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await connection.query('ROLLBACK');
      } catch {
        // Rollback failure must not hide the original error.
      }
      throw error;
    } finally {
      connection.release();
    }
  };

  const close = async () => {
    if (!lifecycle.close()) return;
    if (typeof pool.end === 'function') {
      await pool.end();
    }
  };

  return Object.freeze({ query, execute, transaction, close });
};
