# current-status（正本）

最終更新: 2026-08-06（Issue #137 / PR #138 実PostgreSQL migration executorを実装中）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repositoryのcanonical full nameは`mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収を実装済み。
- HTTP / SQS queue runtime、transactional outbox、Worker-origin retry / stale recoveryを実装済み。
- PR #132でManaged PostgreSQL移行とAPI / Worker / MigratorのECS分離設計をmerge済み。
- PR #134でprovider非依存の非同期DB adapter contractをmerge済み。
- PR #136でversioned migration runnerとSQLite / PostgreSQL共通logical schemaをmerge済み。
- Issue #137 / PR #138で実PostgreSQL migration executor、`pg` driver、実DB integration testを実装中。
- Linearは無料Issue上限のため、Issue #137はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Production相当のDatabase providerは引き続きSQLite `.data/app.db`。
- Existing Repositoryは`node:sqlite`の`DatabaseSync`へ直接接続している。
- API / Workerの各SQLite接続へ5秒の有限`busy_timeout`を設定している。
- Queue transportの既定値はAPI / WorkerともHTTP。
- RDS、ECS、Secrets Manager resourceは未作成。
- APIで提出コードを直接実行せず、hidden testsをlearnerへ返さない。

## Versioned migration（PR #136でmerge済み）

- Migration versionは1からの連番。
- Canonical manifestからprovider別SHA-256 checksumを生成する。
- `schema_migrations`へversion / name / provider / checksum / applied_atを記録する。
- Version gap、name drift、provider mismatch、checksum driftを適用前に拒否する。
- 適用済みmigrationは変更せず、新versionとして追加する。
- DROP TABLE / DROP COLUMN / TRUNCATEをmanifest validatorで拒否する。
- Schema versions:
  1. `core_schema`
  2. `submission_attempt_and_lease`
  3. `queue_outbox`
- ID、timestamp、JSON payloadは初回PostgreSQL移行でもTEXT表現を維持する。

## Issue #137 / PR #138

### 実装済み範囲

- `pg` 8.22.0を固定依存として導入。
- CIの実PostgreSQL versionを18.4へ固定。
- PostgreSQL接続設定をfail-closedで検証。
  - `POSTGRESQL_DATABASE_URL`必須
  - username / password / host / database必須
  - 既定TLSは`verify-full`
  - `disable`はlocalhostまたはtest環境だけ許可
  - schema / pool / timeout設定を検証
- PostgreSQL migration executor。
  - 専用pool connection
  - search path固定
  - 非待機advisory lockによる同時Migrator拒否
  - migration単位transaction
  - DDLとhistory INSERTのatomicity
  - rollback失敗で元migration errorを隠さない
- `DB_PROVIDER=postgresql`で以下を利用可能。
  - `pnpm db:migrate`
  - `pnpm db:migrate --plan`
  - `pnpm db:migrate --status`
- CLIはprovider / version / nameだけを出力し、SQL・parameters・credentials・dataを出力しない。
- GitHub Actions integration jobへPostgreSQL 18.4 service containerを追加。
- 実PostgreSQLへ既存DatabaseClient共通contractを適用。
- 実PostgreSQL migration integrationで以下を検証。
  - migration 1〜3適用
  - 再実行no-op
  - logical table作成
  - outbox CHECK constraint
  - migration失敗時のDDL / history rollback
  - checksum drift拒否
  - concurrent Migrator拒否

### 現在の確認結果

- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- Schema validation: Success
- Infra validation: Success
- 実PostgreSQL integration test: Success
- Docs validation: Success
- Buildを含む最終headの品質ゲートはPR Ready移行前に再確認する。

### 現在の境界

- 実PostgreSQL接続はCI / validation / migration用途に限定する。
- Existing RepositoryとAPI / Worker startupはSQLiteのまま。
- Application roleへDDL権限を与えない。
- ProductionではMigrator専用role / secretを使用する設計を維持する。
- RDS、ECS one-shot Migrator、data migration、production cutoverは未実装。
- JSONB / timestamptz / UUID最適化は初回移行の対象外。

## Correctness・セキュリティ境界

- Submissionとqueue outboxのatomic commitを維持する。
- Processing lease / attempt fencing / completion guardを弱めない。
- Exactly-once queue deliveryへ依存しない。
- Queue / DB内部状態をlearnerへ返さない。
- Migration checksum driftを自動修復しない。
- 同時Migratorは待機させずfail-closedで拒否する。
- SQL、parameters、credentials、submitted code、hidden testsをmigration logへ出力しない。
- DB cutoverとSQS transport切替を同じchange windowへ含めない。

## 現時点の非対応

- Repositoryのasync adapter移行
- Outbox claim / lease
- RDS / Secrets Manager / security group IaC
- SQLite export / PostgreSQL import / validation tool
- API / Worker / Migrator ECS wiring
- Staging cutover rehearsal / rollback drill
- Production DB / SQS切替

## 優先順位

1. Issue #137 / PR #138をレビュー・mergeする。
2. Submission / challenge / outbox Repositoryをasync DatabaseClientへ段階移行する。
3. Outbox claim / leaseを実装する。
4. RDS / Secrets Manager / network IaCを追加する。
5. Data migration toolとstaging cutover rehearsalを実施する。
6. ECS one-shot MigratorとAPI / Worker wiringを追加する。

## 参照先

- Issue #137: `https://github.com/mizzz-ivr/ai-code-dojo/issues/137`
- PR #138: `https://github.com/mizzz-ivr/ai-code-dojo/pull/138`
- Issue #135: `https://github.com/mizzz-ivr/ai-code-dojo/issues/135`
- PR #136: `https://github.com/mizzz-ivr/ai-code-dojo/pull/136`
- DB adapter contract: `docs/architecture/database-client-adapter-contract.md`
- Versioned migration architecture: `docs/architecture/versioned-database-migrations.md`
- PostgreSQL executor architecture: `docs/architecture/postgresql-migration-executor.md`
- PostgreSQL validation runbook: `docs/runbooks/2026-08-06-postgresql-migration-validation.md`
