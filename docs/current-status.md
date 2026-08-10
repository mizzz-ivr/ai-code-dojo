# current-status（正本）

最終更新: 2026-08-07（Issue #139 / PR #140 Admin Challenge Repository async化をレビュー可能状態へ整備）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repositoryのcanonical full nameは`mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収を実装済み。
- HTTP / SQS queue runtime、transactional outbox、Worker-origin retry / stale recoveryを実装済み。
- PR #132でManaged PostgreSQL移行とAPI / Worker / MigratorのECS分離設計をmerge済み。
- PR #134でprovider非依存の非同期DatabaseClient contractをmerge済み。
- PR #136でversioned migration runnerとSQLite / PostgreSQL共通logical schemaをmerge済み。
- PR #138で実PostgreSQL migration executor、`pg` driver、実DB integration testをmerge済み。
- Issue #139 / PR #140でDB-backedなAdmin Challenge Repositoryをasync DatabaseClientへ移行済み。PRはReady for review。
- Linearは無料Issue上限のため、Issue #139はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Production相当のDatabase providerは引き続きSQLite `.data/app.db`。
- Queue transportの既定値はAPI / WorkerともHTTP。
- Public Challenge Repositoryは`problems/examples/*/problem.json`を読むfile-backed実装。
- Admin Challenge Repositoryは`challenges` / `challenge_versions`をDB-backedで管理する。
- Submission / lease / outbox Repositoryは引き続き同期SQLite固有APIへ依存する。
- API / Workerの各SQLite接続へ5秒の有限`busy_timeout`を設定している。
- RDS、ECS、Secrets Manager resourceは未作成。
- APIで提出コードを直接実行せず、hidden testsをlearnerへ返さない。

## PostgreSQL実行基盤（PR #138でmerge済み）

- PostgreSQL 18.4 / `pg` 8.22.0を固定。
- PostgreSQL接続設定をfail-closedで検証する。
- Production既定TLSは`verify-full`。
- URL query parameter / fragmentによる接続設定上書きを拒否する。
- Statement / lock timeoutを有限化する。
- PostgreSQL migration executorは専用connection、search path固定、非待機advisory lockを使用する。
- Migration単位transactionでDDLとhistory INSERTをatomic commitする。
- 初回`schema_migrations`作成もMigration 1 transactionへ含める。
- Rollback / advisory unlock失敗connectionをpoolへ戻さない。
- GitHub ActionsでPostgreSQL 18.4 service containerを使う実DB integration testを実行する。
- Production runtimeのDB providerはこの基盤導入だけでは切り替えない。

## Issue #139 / PR #140

### 目的

DB-backedなAdmin Challenge Repositoryを同期`node:sqlite`直接依存からasync DatabaseClientへ移し、SQLite / PostgreSQLで同じRepository契約を保証する。

Public Challengeのfile-backed配信は変更しない。

### 実装済み範囲

- `createAdminChallengeRepository({ databaseClient })` factoryを追加。
- Admin Challenge Repositoryから`getDb()` / `prepare()` / `run()`の直接依存を除去。
- 現行runtime用に既存SQLite singletonをDatabaseClientで包む境界を追加。
- 既存Repository export名を維持し、Server routeの変更を不要化。
- Challenge作成とVersion 1保存を同一transactionへ変更。
- Version追加と`current_version_id`更新を同一transactionへ変更。
- Challenge Versionは既存Versionを書き換えず追加する。
- SQLite / PostgreSQL共通Repository contract testを追加。
- 実PostgreSQL 18.4で同じRepository contractを実行。

### 同時Version追加

単純な`MAX(version) + 1`はPostgreSQLで同一Challengeへ同時更新された場合に競合するため、Version採番前にChallenge単位でwrite lockを取得する。

- SQLite: DatabaseClientの`BEGIN IMMEDIATE`で直列化。
- PostgreSQL: `UPDATE challenges SET updated_at = updated_at WHERE id = ?`でrow lockを取得。
- Lock取得後に`MAX(version)`を読み、Version INSERTとcurrent pointer更新まで同一transactionで処理。
- `UNIQUE(challenge_id, version)`は最終防御として維持。
- 実PostgreSQLで2件を同時追加し、Version 1 / 2 / 3の連番になることを検証済み。

### Repository contract test

SQLiteとPostgreSQLの両providerで以下を共通確認する。

- empty list
- Challenge作成
- duplicate slug
- Version 1保存
- Version追加
- current version pointer
- 過去Version保持
- publish / draft切替
- published slug lookup
- missing ID / slug
- Challenge作成途中失敗時のrollback

### 最終確認

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- PostgreSQL 18.4 integration test: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success
- PR: Ready for review / mergeable
- Inline review thread: 0件
- 自動Codex review: 利用上限のため未実行
- Manual self-review: 完了。同時Version採番競合を検出・修正済み

### 現在の境界

- Public Challenge Repositoryはfile-backedのまま。
- Admin / internal payloadにはhidden testsを保持するが、learner向け公開Repositoryの除外境界は変更しない。
- Production runtimeはSQLite / HTTPのまま。
- API / Worker composition rootで`DB_PROVIDER=postgresql`を選ぶ変更は未実施。
- Submission / lease / outboxのasync移行は未実施。

## Correctness・セキュリティ境界

- Challenge更新はVersion追加方式を維持する。
- Submissionとqueue outboxのatomic commitを維持する。
- Processing lease / attempt fencing / completion guardを弱めない。
- Exactly-once queue deliveryへ依存しない。
- Queue / DB内部状態やhidden testsをlearnerへ返さない。
- Migration checksum driftを自動修復しない。
- SQL、parameters、credentials、submitted code、hidden testsを新規ログへ出力しない。
- DB cutoverとSQS transport切替を同じchange windowへ含めない。

## 現時点の非対応

- Public Challenge RepositoryのDB-backed化
- Submission read / simple writeのasync DatabaseClient移行
- Processing lease / attempt fencingのasync移行
- Submission + queue outbox atomic transactionのasync移行
- API / Worker composition rootのDB provider切替
- Outbox claim / lease
- RDS / Secrets Manager / security group IaC
- SQLite export / PostgreSQL import / validation tool
- API / Worker / Migrator ECS wiring
- Staging cutover rehearsal / rollback drill
- Production DB / SQS切替

## 優先順位

1. Issue #139 / PR #140をレビュー・mergeする。
2. Submission read / simple writeをasync DatabaseClientへ移行する。
3. Processing lease / attempt fencingをasync DatabaseClientへ移行する。
4. Submission + queue outbox atomic transactionを移行する。
5. API / Worker composition rootのprovider切替を実装する。
6. Outbox claim / leaseを実装する。
7. RDS / Secrets Manager / network IaCを追加する。
8. Data migration toolとstaging cutover rehearsalを実施する。
9. ECS one-shot MigratorとAPI / Worker wiringを追加する。

## 参照先

- Issue #139: `https://github.com/mizzz-ivr/ai-code-dojo/issues/139`
- PR #140: `https://github.com/mizzz-ivr/ai-code-dojo/pull/140`
- Issue #137: `https://github.com/mizzz-ivr/ai-code-dojo/issues/137`
- PR #138: `https://github.com/mizzz-ivr/ai-code-dojo/pull/138`
- DB adapter contract: `docs/architecture/database-client-adapter-contract.md`
- PostgreSQL executor architecture: `docs/architecture/postgresql-migration-executor.md`
- Admin Challenge async repository: `docs/architecture/admin-challenge-async-repository.md`
