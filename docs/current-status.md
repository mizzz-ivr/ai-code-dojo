# current-status（正本）

最終更新: 2026-08-06（Issue #137 / PR #138 実PostgreSQL migration executorをレビュー可能状態へ整備）

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
- Issue #137 / PR #138で実PostgreSQL migration executor、`pg` driver、実DB integration testを実装済み。PRはReady for review。
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
  - URL query parameter / fragmentを拒否
  - 既定TLSは`verify-full`
  - `disable`はlocalhostまたはtest環境だけ許可
  - schema / pool / connection / idle / statement / lock timeoutを検証
- PostgreSQL migration executor。
  - 専用pool connection
  - search path固定
  - 非待機advisory lockによる同時Migrator拒否
  - migration単位transaction
  - 初回`schema_migrations`作成もMigration 1と同じtransactionへ包含
  - DDLとhistory INSERTのatomicity
  - rollback / advisory unlock失敗時はconnectionをpoolへ戻さず破棄
  - rollback失敗で元migration errorを隠さない
- `DB_PROVIDER=postgresql`で以下を利用可能。
  - `pnpm db:migrate`
  - `pnpm db:migrate --plan`
  - `pnpm db:migrate --status`
- CLI成功時はprovider / version / nameだけを出力する。
- CLI失敗時はevent / provider / mode / errorTypeだけをJSON出力し、raw error、stack、cause、connection URLを出力しない。
- GitHub Actions integration jobへPostgreSQL 18.4 service containerを追加。
- 実PostgreSQLへ既存DatabaseClient共通contractを適用。

### 実PostgreSQL test

- Migration 1〜3適用
- 再実行no-op
- Logical table / outbox CHECK constraint
- Migration失敗時のDDL / history rollback
- 初回Migration 1失敗時のbootstrap history table rollback
- Checksum drift拒否
- Concurrent Migrator拒否
- Advisory unlock失敗時のconnection破棄
- CLI失敗時のcredential / host / raw cause非出力
- DatabaseClient query / execute / transaction / lifecycle contract

### 自己レビュー

Ready移行時の自動コードレビューはCodex利用上限により実行されなかったため、PR差分を手動レビューした。

検出・修正:

1. URL query parameterによるTLS設定上書き余地をURL validationで拒否。
2. Uncaught errorの`cause`がCLIへ展開される余地をsafe failure JSONへ変更。
3. Advisory unlock失敗時にlock保持connectionをpoolへ戻す可能性を`release(true)`で解消。
4. 初回Migration 1失敗後にbootstrap history tableだけが残る可能性をtransaction包含で解消。
5. Statement / lock待機が無期限化しないよう有限timeoutを追加。

### 現在の確認結果

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- 実PostgreSQL integration test: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success

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
2. Challenge Repositoryをasync DatabaseClientへ移行する。
3. Submission基本操作、lease / fencing、outbox transactionを段階移行する。
4. Outbox claim / leaseを実装する。
5. RDS / Secrets Manager / network IaCを追加する。
6. Data migration toolとstaging cutover rehearsalを実施する。
7. ECS one-shot MigratorとAPI / Worker wiringを追加する。

## 参照先

- Issue #137: `https://github.com/mizzz-ivr/ai-code-dojo/issues/137`
- PR #138: `https://github.com/mizzz-ivr/ai-code-dojo/pull/138`
- Issue #135: `https://github.com/mizzz-ivr/ai-code-dojo/issues/135`
- PR #136: `https://github.com/mizzz-ivr/ai-code-dojo/pull/136`
- DB adapter contract: `docs/architecture/database-client-adapter-contract.md`
- Versioned migration architecture: `docs/architecture/versioned-database-migrations.md`
- PostgreSQL executor architecture: `docs/architecture/postgresql-migration-executor.md`
- PostgreSQL validation runbook: `docs/runbooks/2026-08-06-postgresql-migration-validation.md`
