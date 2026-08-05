export class DatabaseClientClosedError extends Error {
  constructor() {
    super('database client is closed.');
    this.name = 'DatabaseClientClosedError';
  }
}

export class NestedTransactionError extends Error {
  constructor() {
    super('nested transactions are not supported.');
    this.name = 'NestedTransactionError';
  }
}

export const assertSql = (sql) => {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new TypeError('sql must be a non-empty string.');
  }
};

export const normalizeParameters = (parameters = []) => {
  if (!Array.isArray(parameters)) {
    throw new TypeError('parameters must be an array.');
  }
  return parameters;
};

export const createLifecycleGuard = () => {
  let closed = false;

  return {
    assertOpen() {
      if (closed) throw new DatabaseClientClosedError();
    },
    close() {
      if (closed) return false;
      closed = true;
      return true;
    },
    isClosed() {
      return closed;
    }
  };
};

export const createTransactionClient = ({ query, execute }) => Object.freeze({
  query,
  execute,
  transaction: async () => {
    throw new NestedTransactionError();
  }
});
