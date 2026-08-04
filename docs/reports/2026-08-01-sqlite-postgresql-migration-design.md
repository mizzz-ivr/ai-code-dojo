# SQLiteからPostgreSQLへの移行設計

最終更新: 2026-08-01

- 関連Issue: #131
- ADR: `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- 状態: 設計確定、実装未着手

## 目的

現行SQLite実装を安全にAmazon RDS for PostgreSQLへ移行するため、変更対象、互換性、transaction semantics、段階導入、検証、rollback、後続Issue境界を定義する。

## 現行依存の棚卸し

### `apps/api/src/db/database.mjs`

現行依存:

- `node:sqlite`の`DatabaseSync`
- process working directory基準の`.data/app.db`
- `PRAGMA table_info`
- `CREATE TABLE IF NOT EXISTS`
- 起動時のadditive `ALTER TABLE`
- 起動時のlegacy JSON import
- module-level singleton connection

移行要件:

- Driver選択をconfigへ分離する。
- Schema migrationをapplication startupからone-shot migratorへ移す。
- Local / test用SQLite adapterは維持する。
- Production相当ではPostgreSQL adapterだけを使用する。
- Legacy JSON importはmigration toolへ分離し、runtime startupで実行しない。

### `apps/api/src/repositories/submission-repository.mjs`

現行依存:

- `.prepare().get()` / `.all()` / `.run()`
- `?` placeholder
- `write.changes`
- Sync queryをasync functionから呼び出す構造
- Read後に条件付きUPDATEする処理

移行要件:

- 全queryをasync adapter経由にする。
- `rowCount`を条件付き更新の成功判定に使用する。
- `grading_attempt`、`attempt_idempotency_key`、`completion_guard_at`、lease条件を削除しない。
- Read / update間のraceは最終UPDATE条件で拒否する。
- Terminal保存は`rowCount = 1`だけを成功とする。

### `apps/api/src/repositories/submission-outbox-repository.mjs`

現行依存:

- `BEGIN IMMEDIATE`
- Submission insertとoutbox insertの同一SQLite connection
- `COMMIT` / `ROLLBACK`の手動制御

移行要件:

- Adapterの`transaction(callback)`を使用する。
- Transaction callbackへ同じPostgreSQL clientを渡す。
- Submission / outbox insertのどちらかだけをcommitしない。
- Rollback errorでoriginal errorを隠さない。

### `apps/api/src/repositories/queue-outbox-repository.mjs`

現行依存:

- Pending rowの単純一覧取得
- Claim / leaseなし
- `write.changes`

移行要件:

- 初回portでは現行semanticsを維持する。
- API desired countは1を維持する。
- 複数dispatcherを許可する前にclaim / leaseを追加する。
- Follow-upでは`FOR UPDATE SKIP LOCKED`または明示leaseを利用する。

### `apps/api/src/repositories/stale-submission-recovery-repository.mjs`

現行依存:

- `BEGIN IMMEDIATE`でDB全体のwrite競合を抑制
- Transaction内のcurrent row read
- Multi-step `running -> retry_pending -> queued`
- 条件付きterminal化

移行要件:

- PostgreSQL transaction内で対象submissionを`SELECT ... FOR UPDATE`する。
- Candidate list取得はownership取得として扱わない。
- Current attempt / key / lease expiryをtransaction内で再検証する。
- `rowCount`不一致はno-opまたはtransaction failureとして明示する。

### `apps/api/src/repositories/admin-challenge-repository.mjs`

現行依存:

- Challenge / versionの複数writeがtransaction化されていない経路
- `MAX(version) + 1`
- `write.changes`

移行要件:

- Challenge作成と初期version作成を同一transactionへ移す。
- Version追加はchallenge row lockまたはunique violation retryで競合を処理する。
- Challenge current version更新とversion insertを同一transactionへまとめる。
- Version追加方式を維持し、既存versionを上書きしない。

### `scripts/db-seed.mjs`

移行要件:

- Provider-aware DB clientを利用する。
- Production相当で暗黙seedを行わない。
- Seed dataとmigration dataを分離する。
- Idempotentなfixture / local development用途へ限定する。

### Tests

追加要件:

- Repository contract suiteをSQLite / PostgreSQL双方へ実行する。
- PostgreSQL service containerをCIで起動する。
- Transaction rollback、row lock、conditional update、duplicate deliveryを検証する。
- Migration fixtureをSQLiteからexportし、PostgreSQL import後の不変条件を検証する。

## Database adapter設計

### Interface

```js
export class DatabaseClient {
  async queryOne(statement, params = []) {}
  async queryMany(statement, params = []) {}
  async execute(statement, params = []) {}
  async transaction(callback) {}
  async close() {}
}
```

Transaction callback:

```js
await database.transaction(async (tx) => {
  await tx.execute(statementA, valuesA);
  await tx.execute(statementB, valuesB);
});
```

### Contract

- StatementはSQL textとvalue arrayを受け取る。
- Canonical placeholderは`$1`, `$2`, ...とする。
- `queryOne`は0件で`null`、複数件を暗黙に許容しない。
- `queryMany`は常にarrayを返す。
- `execute`は`{ rowCount }`を返す。
- `transaction`は同じconnectionをcallbackへ渡す。
- Driver errorは保持しつつ、logではallowlistされたerror categoryだけを使用する。

### SQLite adapter

- `DatabaseSync`をadapter内部へ閉じ込める。
- `$n` placeholderをparameter順序を維持してSQLite形式へ変換する。
- `changes`を`rowCount`へ変換する。
- Transactionは現行correctnessを維持する必要がある経路で`BEGIN IMMEDIATE`を利用できる。
- Production相当runtimeでは使用しない。

### PostgreSQL adapter

- `pg.Pool`相当のpoolをprocess単位で1つ持つ。
- Transaction時はpoolからclientをborrowし、`BEGIN` / `COMMIT` / `ROLLBACK`後にreleaseする。
- Statement timeout、connect timeout、pool maxを明示設定する。
- TLS CA検証を必須とする。
- Password / endpoint / full SQL parametersをlogへ出さない。

## Schema migration方針

### Migration metadata

PostgreSQL側へmigration metadata tableを追加する。

```text
schema_migrations
- version text primary key
- applied_at text not null
- checksum text not null
- execution_ms integer not null
```

Rules:

- Migration fileはversion順に一度だけ適用する。
- Applied migrationのchecksum変更を拒否する。
- MigratorはPostgreSQL advisory lockを取得する。
- API / Workerはmigration tableを更新できない。
- Destructive migrationはexpand / contractへ分割する。

### 初回互換schema

初回cutoverでは現行値表現を維持する。

```text
challenges
challenge_versions
submissions
queue_outbox
schema_migrations
```

- ID: text
- Timestamp: UTC ISO 8601 text
- JSON: serialized text
- Integer counter: integer
- Existing unique / foreign key / check constraintを維持する

理由:

- Driver変更とdata model最適化を分離する。
- Existing row mapperとAPI contractへの影響を限定する。
- Timestamp lexical comparisonの既存semanticsを維持する。

### 後続最適化

以下は初回cutover後の別Issueとする。

- JSON text -> `jsonb`
- Timestamp text -> `timestamptz`
- UUID互換ID -> `uuid`
- Partial index / covering index
- Query plan観測に基づくindex調整

## Transaction mapping

| 現行SQLite | PostgreSQL target | 注意点 |
|---|---|---|
| `BEGIN IMMEDIATE` | `BEGIN` + conditional update / row lock | DB全体write lockへ依存しない |
| `.run().changes` | command `rowCount` | 1件だけ成功を確認 |
| `PRAGMA table_info` | versioned migration metadata | Runtime schema introspectionを廃止 |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` | 対象constraintを明示 |
| `MAX(version)+1` | row lock + increment / unique retry | concurrent version追加を考慮 |
| Sync singleton | Async pool | Pool budgetとshutdownを管理 |

## Correctness test matrix

### Submission / outbox

- Submission insert成功 + outbox insert成功 -> both committed
- Submission insert成功 + outbox insert失敗 -> both rolled back
- Transaction commit失敗 -> both absent
- Duplicate submission / attempt -> unique constraint rejection

### Claim / lease

- Same attemptを2 Workerがclaim -> 1件だけ`rowCount = 1`
- Expired lease heartbeat -> rejected
- Old attempt terminal save -> rejected
- Completion guard後のupdate -> rejected / safe current return

### Stale recovery

- Same stale candidateを2 scannerが処理 -> 1 transactionだけstate transition
- Retry上限未満 -> new attempt / new key
- Retry上限到達 -> completion guard付き`infra_failed`
- Enqueue失敗 -> queued attemptのfenced terminal化

### Challenge version

- Concurrent version作成 -> version重複なし
- Version insert失敗 -> current version pointer未更新
- Publish status update -> challenge existenceを条件に1件更新

### Outbox

- Single dispatcherでpending順序を維持
- Publish成功時だけpublishedへ更新
- Publish失敗時はpending維持
- 複数dispatcher testはclaim / lease Issueで追加

## Data export / import形式

SQLite専用export toolを実装する。

Output layout:

```text
export-manifest.json
challenges.ndjson
challenge-versions.ndjson
submissions.ndjson
queue-outbox.ndjson
```

Manifest:

- export version
- created at
- source DB file hash
- table row counts
- per-file SHA-256
- schema version
- source application commit

Rules:

- Export前にapplication writeを停止する。
- Primary key順で決定的に出力する。
- Submitted code / hidden testsを含むためartifactをpublic CIへuploadしない。
- Export artifactは暗号化された管理領域だけへ保存する。

Import rules:

- Empty target databaseだけを受け付ける。
- FK順に同一transactionまたはtable単位のcontrolled transactionでimportする。
- Duplicate / malformed rowで即時失敗する。
- Import後にconstraintを無効化したままにしない。

## Validation

### Row-level

- Table row count一致
- Primary key集合一致
- Required field null差異なし
- JSON parse成功
- Timestamp format検証

### Invariant-level

- Challenge current versionが存在する
- Challenge version `(challenge_id, version)`がunique
- Submission `(id, grading_attempt)`がunique
- Attempt idempotency keyがunique
- Outbox `(submission_id, grading_attempt)`がunique
- Outbox submission foreign keyが存在する
- Completed / failed / infra_failed rowにcompletion guardが存在する
- Running rowのlease fieldsが整合する
- Pending outbox messageのattempt / keyがsubmission current attemptと整合する

### Application smoke

- Published challenge一覧 / 詳細
- Submission作成
- Transactional outbox作成
- Worker claim / heartbeat / completion
- Retry / stale recovery
- Learner-safe result
- Admin challenge version追加 / publish

## Cutover phases

### Phase 0: Design

- 本Issue #131
- ADR / topology / risk / cutover draftを確定

### Phase 1: Adapter foundation

- SQLite adapterを既存behaviorのまま導入
- PostgreSQL adapterを追加
- Dual-provider repository contract testを追加
- Default providerはSQLiteを維持

### Phase 2: Migration foundation

- Versioned migration runner
- PostgreSQL schema
- Migrator CLI / one-shot task entrypoint
- Migration checksum / lock

### Phase 3: Repository port

- Challenge repository
- Submission repository
- Outbox repository
- Stale recovery repository
- Seed / test helper

各repository単位で小さいPRへ分割してよいが、cross-repository transactionは同一PRで整合させる。

### Phase 4: Scale safety

- Outbox claim / lease
- API multiple replica test
- Pool budget test

### Phase 5: AWS data plane

- RDS PostgreSQL
- Secrets Manager
- DB subnet group / security group
- Backup / deletion protection / monitoring

### Phase 6: Data migration tooling

- Export
- Import
- Validation report
- Rollback preparation

### Phase 7: ECS wiring

- API task / service
- Worker task / service
- Migrator task
- Separate task / execution roles
- HTTP transportでstaging smoke

### Phase 8: Queue cutover

- Separate approvalでSQS transportへ切り替える。
- DB cutoverと同じchange windowへ混在させない。

## Rollback decision

### Write再開前

- PostgreSQL applicationを停止する。
- SQLite backupをrestoreする。
- Previous task definitionへ戻す。
- Data divergenceは発生していない。

### Write再開後

単純切戻しを禁止する。

選択肢:

1. PostgreSQL側のapplication rollbackだけを行い、同じPostgreSQL schemaを継続使用する。
2. RDS snapshot / PITRから新instanceを作成する。
3. 明示的reverse exportを実行し、data loss / downtimeを承認してSQLiteへ戻す。

Write再開後のSQLite復帰は最終手段である。

## Follow-up Issue候補

| 順序 | Issue候補 | 主な完了条件 | Blocker |
|---:|---|---|---|
| 1 | DB adapterとdual-provider contract test | SQLite behavior維持、PostgreSQL CI起動 | #131 |
| 2 | Versioned migration runnerとPostgreSQL schema | checksum、lock、expand migration | 1 |
| 3 | Repository async adapter移行 | 全repository contract成功 | 1,2 |
| 4 | Outbox claim / lease | Multiple dispatcher安全化 | 3 |
| 5 | RDS / secret / network IaC | Review-only change set成功 | 2,3 |
| 6 | Export / import / validation tool | Fixture移行と検証成功 | 2,3 |
| 7 | API / Worker / Migrator ECS wiring | Separate role / task、HTTP smoke | 4,5,6 |
| 8 | Staging rehearsal | Cutover / rollback drill成功 | 7 |
| 9 | Production相当cutover | 承認、backup、validation | 8 |

## 対象外

- 本Issue内のapplication code変更
- Actual AWS resource作成
- Production cutover
- RDS Proxy
- IAM DB authentication
- Schema type最適化
- SQS production切替
