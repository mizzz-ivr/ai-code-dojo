# Issue #133 非同期DB adapter contract 実装ログ

## 目的

Managed PostgreSQL移行の第一段階として、既存SQLite runtimeを変更せずにprovider共通のDB contractとテスト基盤を追加する。

## 実装内容

- `query` / `execute` / `transaction` / `close`の共通境界
- SQLite `DatabaseSync` adapter
- PostgreSQL pool / connection注入adapter
- `?`からPostgreSQL positional placeholderへの変換
- provider selectionのfail-closed validation
- SQLite実DBとPostgreSQL fake poolの共通contract test

## 初回CIで検出した問題

SQLiteの`DatabaseSync`はquery rowをnull prototype objectとして返すため、PostgreSQL側のplain objectと`deepStrictEqual`で一致しなかった。

テストをprovider固有仕様へ緩和せず、SQLite adapterでrowをplain objectへ正規化した。これにより共通contractがprovider差異を吸収する責務を維持した。

## 非対象

- 実`pg` package
- 実PostgreSQL接続
- 既存Repositoryのadapter接続
- schema migration
- RDS / ECS resource
- production DB切替

## 安全性

- 既存runtime経路は変更しない。
- SQL、parameters、credentialsをログ出力しない。
- nested transactionとclose後操作を拒否する。
- rollback失敗で元例外を隠さない。
