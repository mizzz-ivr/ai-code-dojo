const cloneRows = (rows) => rows.map((row) => ({ ...row }));

const executeSql = (state, sql, parameters = []) => {
  const normalized = sql.trim().replace(/\s+/g, ' ').toUpperCase();

  if (normalized.startsWith('CREATE TABLE')) {
    state.rows = [];
    return { rows: [], rowCount: 0 };
  }

  if (normalized.startsWith('INSERT INTO CONTRACT_ITEMS')) {
    state.rows.push({ id: parameters[0], name: parameters[1] });
    return { rows: [], rowCount: 1 };
  }

  if (normalized.startsWith('SELECT ID, NAME FROM CONTRACT_ITEMS WHERE ID =')) {
    const rows = state.rows.filter((row) => row.id === parameters[0]);
    return { rows: cloneRows(rows), rowCount: rows.length };
  }

  if (normalized === 'SELECT 1') {
    return { rows: [{ '?column?': 1 }], rowCount: 1 };
  }

  throw new Error(`unsupported fake PostgreSQL SQL: ${sql}`);
};

export const createFakePostgresqlPool = () => {
  const state = { rows: [] };
  let ended = false;

  const assertOpen = () => {
    if (ended) throw new Error('pool is ended');
  };

  return {
    async query(sql, parameters = []) {
      assertOpen();
      return executeSql(state, sql, parameters);
    },
    async connect() {
      assertOpen();
      let transactionState = null;
      let released = false;

      return {
        async query(sql, parameters = []) {
          if (released) throw new Error('connection is released');
          const command = sql.trim().toUpperCase();

          if (command === 'BEGIN') {
            transactionState = { rows: cloneRows(state.rows) };
            return { rows: [], rowCount: 0 };
          }
          if (command === 'COMMIT') {
            state.rows = cloneRows(transactionState?.rows ?? state.rows);
            transactionState = null;
            return { rows: [], rowCount: 0 };
          }
          if (command === 'ROLLBACK') {
            transactionState = null;
            return { rows: [], rowCount: 0 };
          }

          return executeSql(transactionState ?? state, sql, parameters);
        },
        release() {
          released = true;
        }
      };
    },
    async end() {
      ended = true;
    }
  };
};
