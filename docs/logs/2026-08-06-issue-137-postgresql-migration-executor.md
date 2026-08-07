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
- URL query parameter / fragmentを拒否。
- 既定TLSを`verify-full`に設定。
- SSL disableをlocalhost / test環境だけ許可。
- Schema、pool max、connection timeout、idle timeoutを検証。
- Statement timeout 60秒、lock timeout 5秒を既定化。
- Search pathを検証済みschemaへ固定。

### Migration executor

- 専用pool connection。
- Session-level advisory lock。
- `pg_try_advisory_lock`による非待機lock取得。
- Applied historyのversion / name / provider / checksum検証。
- Migration単位transaction。
- 初回`schema_migrations`作成をMigration 1 transactionへ包含。
- Provider schema stepsとhistory INSERTをatomic commit。
- Failure時rollback。
- Rollback / advisory unlock失敗時はconnectionを破棄。

### CLI

`DB_PROVIDER=postgresql`で以下に対応。

- `pnpm db:migrate`
- `pnpm db:migrate --plan`
- `pnpm db:migrate --status`

成功Outputはprovider / version / nameへ制限。

失敗Outputは次のallowlist fieldへ制限。

- event
- provider
- mode
- errorType

Raw message、stack、cause、connection URL、SQL、parametersは出力しない。

### CI

- PostgreSQL image: `postgres:18.4-bookworm`
- CI database: `dojo_test`
- Health check: `pg_isready`
- Testごとに一意schemaを作成・破棄。

## Test

### Unit

- Connection URL必須
- Protocol / URL component
- URL query / fragment拒否
- TLS default / disable境界
- Schema / pool / connection / statement / lock timeout validation
- Pool option wiring
- Migration table SQLのprovider互換性
- Advisory unlock失敗時の`release(true)`
- CLI failureのcredential / host / raw cause非出力

### Integration

- PostgreSQL server version 18.4
- DatabaseClient query / execute
- Transaction commit / rollback
- Nested transaction拒否
- Close冪等性
- Migration 1〜3適用
- Rerun no-op
- Logical table / constraint
- Migration 4 failure DDL / history rollback
- Initial Migration 1 failure bootstrap rollback
- Checksum drift拒否
- Concurrent Migrator拒否

## CIで検出・修正した差異

Migration table SQLをSQLite runnerからprovider共通moduleへ分離した際、既存unit testのimport先が旧moduleのまま残った。

- Testを緩和せずimport先を`migration-table-sql.mjs`へ修正。
- 修正後unit test成功。
- 実PostgreSQL integrationは初回から成功。

## Manual self-review

Ready移行時の自動Codex reviewは利用上限により実行されなかったため、PR patchを手動レビューした。

### 検出1: URL queryによるTLS上書き余地

Connection URLへ`sslmode`等を含めると、code側SSL設定と管理元が分散する。

対応:

- URL query parameter / fragmentを拒否。
- TLS設定を`POSTGRESQL_SSL_MODE`へ一元化。
- Unit test追加。

### 検出2: CLI error causeの機微情報展開余地

Uncaught errorのstack / causeに接続先やdriver errorが含まれる可能性がある。

対応:

- Top-level catchを追加。
- Allowlist JSONだけをstderrへ出力。
- Password、host、raw cause非出力testを追加。

### 検出3: Unlock失敗connectionのpool再利用

Session advisory lock解放に失敗したconnectionを通常releaseすると、lock保持状態をpoolへ戻す可能性がある。

対応:

- Unlock失敗時に`release(true)`で破棄。
- Lifecycle unit test追加。

### 検出4: 初回failure後のbootstrap table残存

`schema_migrations`をMigration 1 transaction外で作成すると、Migration 1失敗時にhistory tableだけが残る。

対応:

- 初回history table作成をMigration 1 transactionへ移動。
- Fresh schema failure integration test追加。

### 検出5: Statement / lock待機上限不足

Connection timeoutだけではquery実行やobject lock待機が長期化する可能性がある。

対応:

- Statement timeout既定60秒。
- Lock timeout既定5秒。
- Boundary test追加。

## Final CI

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- PostgreSQL 18.4 integration: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success

## Correctness境界

- Production runtimeはSQLite / HTTPを維持。
- Application roleへDDL権限を与えない。
- 同時Migratorを待機させずfail-closedで拒否。
- Applied migrationを編集しない。
- Driftを自動修復しない。
- SQL、parameters、credentials、submitted code、hidden tests、raw causeを公開ログへ出力しない。

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
