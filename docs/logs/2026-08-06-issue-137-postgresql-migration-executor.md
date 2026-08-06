# Issue #137 実PostgreSQL migration executor 実装ログ

## 目的

Versioned migration manifestを実PostgreSQL 18.4へ適用し、schema・transaction・drift検出・DatabaseClient contractを実DBで検証できるようにする。

## 実装

### Dependency

- `pg` 8.22.0を固定。
- pnpm lockfileを更新。
- Frozen lockfile installを維持。

### Connection config

- `POSTGRESQL_DATABASE_URL`必須。
- username / password / host / databaseを必須化。
- 既定TLSを`verify-full`に設定。
- SSL disableをlocalhost / test環境だけ許可。
- Schema、pool max、connection timeout、idle timeoutを検証。
- Search pathを検証済みschemaへ固定。

### Migration executor

- 専用pool connection。
- Session-level advisory lock。
- `pg_try_advisory_lock`による非待機lock取得。
- Applied historyのversion / name / provider / checksum検証。
- Migration単位transaction。
- Provider schema stepsとhistory INSERTをatomic commit。
- Failure時rollback。
- Lock releaseとconnection release。

### CLI

`DB_PROVIDER=postgresql`で以下に対応。

- `pnpm db:migrate`
- `pnpm db:migrate --plan`
- `pnpm db:migrate --status`

Outputはprovider / version / nameへ制限。

### CI

- PostgreSQL image: `postgres:18.4-bookworm`
- CI database: `dojo_test`
- Health check: `pg_isready`
- Testごとに一意schemaを作成・破棄。

## Test

### Unit

- Connection URL必須
- Protocol / URL component
- TLS default / disable境界
- Schema / pool / timeout validation
- Pool option wiring
- Migration table SQLのprovider互換性

### Integration

- PostgreSQL server version 18.4
- DatabaseClient query / execute
- Transaction commit / rollback
- Nested transaction拒否
- Close冪等性
- Migration 1〜3適用
- Rerun no-op
- Logical table / constraint
- Failure DDL / history rollback
- Checksum drift拒否
- Concurrent Migrator拒否

## CIで検出・修正した差異

Migration table SQLをSQLite runnerからprovider共通moduleへ分離した際、既存unit testのimport先が旧moduleのまま残った。

- Testを緩和せずimport先を`migration-table-sql.mjs`へ修正。
- 修正後unit test成功。
- 実PostgreSQL integrationは初回から成功。

## Correctness境界

- Production runtimeはSQLite / HTTPを維持。
- Application roleへDDL権限を与えない。
- 同時Migratorを待機させずfail-closedで拒否。
- Applied migrationを編集しない。
- Driftを自動修復しない。
- SQL、parameters、credentials、submitted code、hidden testsをログへ出力しない。

## 非対象

- Repository async移行
- RDS / ECS / Secrets Manager
- Data migration / cutover
- JSONB / timestamptz / UUID最適化

## 管理

- GitHub Issue: #137
- GitHub PR: #138
- Branch: `feat/postgresql-migration-executor`
- Linear: Free Issue limitのため作成不可
