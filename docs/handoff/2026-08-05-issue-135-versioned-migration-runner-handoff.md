# Issue #135 Handoff

## 現在地

Versioned migration manifest、SQLite runner、PostgreSQL互換schema、plan / status CLIをPR #136で実装した。

## 実装済み

- `apps/api/src/db/migrations/migration-contract.mjs`
- `apps/api/src/db/migrations/migration-manifest.mjs`
- `apps/api/src/db/migrations/sqlite-migration-runner.mjs`
- `database.mjs` startup migration接続
- `db:migrate --plan` / `--status`
- Drift / rollback / rerun test
- Canonical docs / architecture / runbook

## 重要な判断

- Existing SQLite runtimeを維持する。
- ManifestはSQLite / PostgreSQL両providerを必須とする。
- Applied migrationを編集しない。
- Checksum driftはfail-closedとする。
- Migration単位transactionとする。
- Initial PostgreSQL schemaでもID / timestamp / JSONはTEXTを維持する。
- Destructive migrationとdown migrationは対象外とする。

## 不変条件

- Submission + outbox atomicityを維持する。
- Processing lease / attempt fencing / completion guardを維持する。
- APIでsubmission codeを直接実行しない。
- Hidden testsをlearnerへ返さない。
- Production transportはHTTPのまま。

## 次タスク推奨

実PostgreSQL test environment、`pg` driver、PostgreSQL migration executorを追加する。

### 推奨scope

- CI PostgreSQL service container
- Exact PostgreSQL major version固定
- `pg` pool factory
- PostgreSQL migration table bootstrap
- Manifest step executor
- Same migration plan / checksum validation
- Fresh DB apply / rerun / rollback integration test
- TLS / credential logging禁止契約

### 非対象候補

次PRへ混在させない。

- Repository全体のasync移行
- RDS IaC
- ECS Migrator task
- Production cutover
- JSONB / timestamptz / uuid化

## Review重点

- Existing untracked SQLite DBのbaseline安全性
- History driftのfail-closed動作
- Migration失敗時のpartial schema防止
- PostgreSQL schemaへのSQLite構文非混入
- CLIへ機微情報を出さないこと
