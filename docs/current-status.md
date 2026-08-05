# current-status（正本）

最終更新: 2026-08-05（Issue #135 / PR #136 Versioned migration runner実装中）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repositoryのcanonical full nameは`mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収を実装済み。
- HTTP / SQS queue runtime、transactional outbox、Worker-origin retry / stale recoveryを実装済み。
- PR #132でManaged PostgreSQL移行とAPI / Worker / MigratorのECS分離設計をmerge済み。
- PR #134でprovider非依存の非同期DB adapter contractとSQLite / PostgreSQL共通contract testをmerge済み。
- Issue #135 / PR #136でversioned migration runnerとPostgreSQL互換schemaを実装中。
- Linearは無料Issue上限のため、Issue #135はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Database providerはSQLite `.data/app.db`。
- 既存Repositoryは`node:sqlite`の`DatabaseSync`へ直接接続している。
- Queue transportの既定値はAPI / WorkerともHTTP。
- Production相当のPostgreSQL、RDS、ECS resourceは未作成。
- APIで提出コードを直接実行せず、hidden testsをlearnerへ返さない。

## DB adapter contract（PR #134でmerge済み）

- async `DatabaseClient` contract
  - `query`
  - `execute`
  - `transaction`
  - `close`
- SQLite `DatabaseSync` adapter
- PostgreSQL pool / connection注入adapter境界
- `DB_PROVIDER=sqlite|postgresql`のfail-closed validation
- `?`からPostgreSQL positional placeholderへの変換
- SQLite / PostgreSQL間でquery row、`rowCount`、transaction semanticsを正規化
- SQLite transaction中の外側query / execute / closeを拒否し、単一接続への処理混入を防止

## Issue #135 / PR #136

### 実装済み範囲

- Migration versionは1からの連番
- Migration name重複、provider定義欠落、version gapを拒否
- Canonical manifestからSHA-256 checksumを生成
- `schema_migrations`へversion / name / provider / checksum / applied_atを記録
- Applied historyの以下を適用前に拒否
  - version gap
  - name drift
  - provider mismatch
  - checksum drift
- SQLite migration単位で`BEGIN IMMEDIATE` / COMMIT / ROLLBACK
- Schema変更とhistory insertを同じtransactionで実行
- Existing untracked SQLite schemaをintrospectionしてbaseline化
- 再実行時はno-op
- Migration失敗時はpartial schemaとhistoryをrollback

### Versioned schema

1. `core_schema`
   - `challenges`
   - `challenge_versions`
   - `submissions`
2. `submission_attempt_and_lease`
   - grading attempt
   - attempt idempotency key
   - completion guard
   - processing claim / heartbeat / lease
3. `queue_outbox`
   - transactional outbox
   - status / publish attempt constraints
   - pending index

SQLite / PostgreSQLで同じlogical schemaを定義し、初回移行ではID、timestamp、JSON payloadを既存どおりTEXTで維持する。

### CLI

- `pnpm db:migrate`
  - 未適用migrationを適用する。
- `pnpm db:migrate --plan`
  - Applied / pending versionとnameを表示する。
  - DBが存在しない場合もDB fileを作成しない。
- `pnpm db:migrate --status`
  - 現在のmigration状態を表示する。
- SQL、parameters、submitted code、hidden tests、credentialsを出力しない。

### 現在の境界

- PostgreSQL schemaはmanifestへ追加済みだが、実`pg`接続では未実行。
- PostgreSQL migration runnerは未実装。
- Existing Repositoryは同期SQLite接続のまま。
- Production runtimeはSQLite / HTTPを維持する。
- Destructive down migrationは提供しない。

## Managed DB設計（PR #132で確定）

- Target DBはAmazon RDS for PostgreSQL provisioned。
- API / Workerは別ECS service / task definition。
- Schema migrationはone-shot Migrator task。
- PostgreSQL roleとSecrets Manager secretをAPI / Worker / Migratorで分離する。
- Initial authenticationはpassword + TLS verify-full。
- IAM DB authentication / RDS Proxyは初回対象外。
- Outbox claim / lease完了前はAPI desired countを1に固定する。
- DB cutoverとSQS transport切替を同じchange windowへ含めない。

## Correctness・セキュリティ境界

- Submissionとqueue outboxのatomic commitを維持する。
- Processing lease / attempt fencing / completion guardを弱めない。
- Exactly-once queue deliveryへ依存しない。
- Queue / DB内部状態をlearnerへ返さない。
- Application roleへDDL権限を与えない。
- Migration checksum driftを自動修復せずfail-closedとする。
- 適用済みmigrationを変更しない。変更は新versionとして追加する。
- DROP TABLE / DROP COLUMN / TRUNCATEをmanifest validatorで拒否する。

## 現時点の非対応

- 実`pg` driver / PostgreSQL integration test
- PostgreSQL migration executor
- Repositoryのasync adapter移行
- Outbox claim / lease
- RDS / Secrets Manager / security group IaC
- SQLite export / PostgreSQL import / validation tool
- API / Worker / Migrator ECS wiring
- Production DB / SQS切替

## 優先順位

1. Issue #135 / PR #136をレビュー・mergeする。
2. 実PostgreSQL test environment、`pg` driver、migration executorを導入する。
3. Repositoryをasync adapterへ段階移行する。
4. Outbox claim / leaseを実装する。
5. RDS / Secrets Manager / network IaCを追加する。
6. Data migration toolとstaging cutover rehearsalを実施する。
7. ECS wiringを追加する。

## 参照先

- Issue #135: `https://github.com/mizzz-ivr/ai-code-dojo/issues/135`
- PR #136: `https://github.com/mizzz-ivr/ai-code-dojo/pull/136`
- Issue #133: `https://github.com/mizzz-ivr/ai-code-dojo/issues/133`
- PR #134: `https://github.com/mizzz-ivr/ai-code-dojo/pull/134`
- DB adapter contract: `docs/architecture/database-client-adapter-contract.md`
- Migration architecture: `docs/architecture/versioned-database-migrations.md`
- Migration runbook: `docs/runbooks/2026-08-05-versioned-database-migration.md`
