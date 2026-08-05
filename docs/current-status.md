# current-status（正本）

最終更新: 2026-08-05（Issue #133 / PR #134 非同期DB adapter contractを実装中）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repositoryのcanonical full nameは`mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収を実装済み。
- HTTP / SQS queue runtime、transactional outbox、Worker-origin retry / stale recoveryを実装済み。
- PR #132でManaged PostgreSQL移行とAPI / Worker / MigratorのECS分離設計をmerge済み。
- Issue #133 / PR #134でprovider非依存の非同期DB adapter contractを実装中。
- Linearは無料Issue上限のため、Issue #133はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Database providerはSQLite `.data/app.db`。
- 既存Repositoryは`node:sqlite`の`DatabaseSync`へ直接接続している。
- Queue transportの既定値はAPI / WorkerともHTTP。
- Production相当のPostgreSQL、RDS、ECS resourceは未作成。
- APIで提出コードを直接実行せず、hidden testsをlearnerへ返さない。

## Managed DB設計（PR #132で確定）

- Target DBはAmazon RDS for PostgreSQL provisioned。
- API / Workerは別ECS service / task definition。
- Schema migrationはone-shot Migrator task。
- PostgreSQL roleとSecrets Manager secretをAPI / Worker / Migratorで分離する。
- Initial authenticationはpassword + TLS verify-full。
- IAM DB authentication / RDS Proxyは初回対象外。
- Initial cutoverでは既存ID / JSON / timestampのtext表現を維持する。
- Outbox claim / lease完了前はAPI desired countを1に固定する。
- DB cutoverとSQS transport切替を同じchange windowへ含めない。

## Issue #133 / PR #134

### 実装済み範囲

- async `DatabaseClient` contract
  - `query`
  - `execute`
  - `transaction`
  - `close`
- SQLite `DatabaseSync` adapter
- PostgreSQL pool / connection注入adapter境界
- `DB_PROVIDER=sqlite|postgresql`のfail-closed validation
- `?`からPostgreSQL positional placeholderへの変換
- SQLite実memory DB / PostgreSQL fake poolへ同じcontract testを適用
- transaction commit / rollback
- nested transaction拒否
- close冪等性 / close後操作拒否

### 重要な境界

- 新adapterは既存Repository / server startupへまだ接続していない。
- `pg` packageと実PostgreSQL接続は未導入。
- Production runtimeはSQLite / HTTPを維持する。
- SQL、parameters、credentials、submitted code、hidden testsをadapterからログ出力しない。

### 初回CIで検出・修正した差異

SQLite query rowがnull prototype objectで返るため、PostgreSQL側のplain objectと共通contractで一致しなかった。SQLite adapterでrowをplain objectへ正規化し、provider差異をadapter内へ閉じ込めた。

## Correctness・セキュリティ境界

- Submissionとqueue outboxのatomic commitを維持する。
- Processing lease / attempt fencing / completion guardを弱めない。
- Exactly-once queue deliveryへ依存しない。
- Queue / DB内部状態をlearnerへ返さない。
- Application roleへDDL権限を与えない。
- 未対応DB providerをfail-closedで拒否する。

## 現時点の非対応

- 実`pg` driver / PostgreSQL integration test
- Versioned migration runner / PostgreSQL schema
- Repositoryのasync adapter移行
- Outbox claim / lease
- RDS / Secrets Manager / security group IaC
- SQLite export / PostgreSQL import / validation tool
- API / Worker / Migrator ECS wiring
- Production DB / SQS切替

## 優先順位

1. Issue #133 / PR #134をレビュー・mergeする。
2. Versioned migration runnerとPostgreSQL互換schemaを実装する。
3. 実PostgreSQL test environmentとdriverを導入する。
4. Repositoryをasync adapterへ段階移行する。
5. Outbox claim / leaseを実装する。
6. RDS / Secrets Manager / network IaCを追加する。
7. Data migration toolとstaging cutover rehearsalを実施する。
8. ECS wiringを追加する。

## 参照先

- Issue #133: `https://github.com/mizzz-ivr/ai-code-dojo/issues/133`
- PR #134: `https://github.com/mizzz-ivr/ai-code-dojo/pull/134`
- DB adapter contract: `docs/architecture/database-client-adapter-contract.md`
- Managed DB topology: `docs/architecture/managed-db-ecs-topology.md`
- Validation runbook: `docs/runbooks/2026-08-05-database-provider-contract-validation.md`
