# Issue #133 handoff

## 状態

- GitHub Issue: #133
- GitHub PR: #134
- Branch: `feat/async-db-adapter-contract`
- Linear: 無料Issue上限により作成不可

## 完了範囲

- provider非依存async DatabaseClient contract
- SQLite adapter
- PostgreSQL driver注入境界
- provider factory / fail-closed config
- SQLite / PostgreSQL共通contract test
- placeholder変換test

## 重要な境界

- 既存Repositoryとruntimeはまだ新adapterへ接続していない。
- PostgreSQLはfake pool testのみで、実`pg`接続ではない。
- ProductionはSQLite / HTTPを維持する。
- SQL、parameters、credentialsをログへ出さない。

## 後続

1. Versioned migration runnerとPostgreSQL互換schema
2. 実PostgreSQL test environmentとdriver
3. Repositoryのasync adapter移行
4. Outbox claim / lease
5. RDS / Secrets Manager / network IaC

## レビュー観点

- provider固有型がcontract外へ漏れていないか
- transaction connectionが固定されるか
- rollbackが元例外を隠さないか
- common contract testを実DB integrationへ再利用できるか
