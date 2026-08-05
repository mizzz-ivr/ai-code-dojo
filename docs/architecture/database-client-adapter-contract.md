# 非同期DatabaseClient adapter contract

最終更新: 2026-08-05

## 目的

SQLiteからManaged PostgreSQLへ段階移行するため、RepositoryとDB providerの間で維持する最小の非同期契約を定義する。

## 現在の位置付け

Issue #133 / PR #134ではcontractとadapterを並行追加する。既存Repository、migration、API / Worker startupは引き続き`node:sqlite`の既存経路を利用し、新adapterへはまだ接続しない。

## 共通contract

- `query(sql, parameters)`はplain objectの配列を返す。
- `execute(sql, parameters)`は`rowCount`と`lastInsertId`を返す。
- `transaction(operation)`は同一DB connection上でoperationを実行する。
- `close()`は冪等にする。
- close後の操作は`DatabaseClientClosedError`で拒否する。
- nested transactionは`NestedTransactionError`で拒否する。
- SQLは空文字を拒否し、parametersは配列だけを許可する。

## SQLite adapter

- `DatabaseSync`の同期操作をPromise contractへ正規化する。
- transactionは`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`を使用する。
- SQLite固有のnull prototype rowをplain objectへ変換する。
- `changes`を`rowCount`、`lastInsertRowid`を`lastInsertId`へ変換する。

## PostgreSQL adapter境界

- `pool`をdependency injectionし、このIssueでは`pg` packageを導入しない。
- 通常queryはpool、transactionは`pool.connect()`で得た同一connectionを使う。
- `rows`と`rowCount`を共通結果へ正規化する。
- 既存SQL移行の補助として、single-quoted literal外の`?`を`$1...`へ変換する。
- rollback失敗は元のapplication errorを隠さない。

## セキュリティ境界

- SQL、parameters、credentials、submitted code、hidden testsをadapterからログ出力しない。
- 未対応providerはfail-closedで拒否する。
- PostgreSQL credentialやendpointは本Issueでは扱わない。

## Test contract

SQLite memory DBとPostgreSQL fake poolへ同じcontract testを適用する。

- query / execute result normalization
- transaction commit
- transaction rollback
- nested transaction rejection
- idempotent close
- operation rejection after close
- provider selection validation
- placeholder conversion boundaries

実PostgreSQL integration testは`pg` driverとversioned schemaを導入する後続Issueで追加する。
