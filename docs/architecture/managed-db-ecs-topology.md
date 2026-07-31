# Managed DB / ECS実行トポロジー

最終更新: 2026-08-01

- 関連Issue: #131
- ADR: `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- 状態: 設計確定、resource / application実装未着手

## 目的

API / Workerの責務、AWS IAM、PostgreSQL role、network、migration ownershipを分離し、ECS wiringを安全に実装するための正本を定義する。

## 現行と移行後

### 現行

```text
API process ----+
                +--> local SQLite .data/app.db
Worker process -+

API -> HTTP POST /jobs -> Worker
```

### 移行後の目標

```text
Internet
   |
  ALB
   |
API ECS Service / API Task Role
   |                         \
   | PostgreSQL TLS           \ SendMessage
   v                           v
RDS for PostgreSQL <-------- Source SQS Queue
   ^                           |
   | PostgreSQL TLS            | Receive / Visibility / Delete
   |                           v
Worker ECS Service / Worker Task Role
   |
   +--> Runner isolation boundary

DB Migrator one-shot ECS Task
   |
   +--> versioned schema migration

Secrets Manager
   +--> API DB secret via API execution role
   +--> Worker DB secret via Worker execution role
   +--> Migrator DB secret via Migrator execution role
```

## ECS service境界

### API service

責務:

- Public / learner / admin HTTP API
- Challenge管理
- Submission作成・参照
- Transactional outbox作成・dispatch
- API queue producer runtime

持たない責務:

- 提出コード実行
- Queue consume
- Worker retry / stale recovery
- DDL / schema migration

Task role:

- Source queueへの`sqs:SendMessage`
- 必要なtelemetry権限だけ
- Receive / Delete / ChangeVisibility / DLQ read / queue管理を付与しない

### Worker service

責務:

- HTTP / SQS queue consume
- Submission claim
- Processing lease / heartbeat
- Runner呼び出し
- Application retry
- Stale running recovery
- Terminal結果保存

持たない責務:

- Challenge管理write
- Queue outbox dispatch
- DDL / schema migration
- Public HTTP API

Task role:

- Source queueへの以下だけ
  - `sqs:ReceiveMessage`
  - `sqs:DeleteMessage`
  - `sqs:ChangeMessageVisibility`
  - `sqs:SendMessage`
- DLQ read / purge / queue管理を付与しない

### Migrator task

責務:

- Versioned migrationの実行
- Migration version tableの管理
- PostgreSQL advisory lockによるsingle runner保証
- Migration結果の構造化ログ出力

持たない責務:

- API / Worker runtime
- Queue操作
- Learner data表示
- 定常稼働

Execution方式:

- Deploy pipelineまたは明示承認されたone-shot ECS taskとして実行する。
- API / Worker task起動時に自動migrationしない。
- Expand migration成功後にapplication deployを行う。
- Destructive migrationは別承認とbackup確認を必須とする。

## IAMとDB権限の二層分離

AWS task roleはAWS APIへの権限を制御する。PostgreSQL roleはDB内部のtable / schema権限を制御する。どちらか一方だけで最小権限を実現したことにしない。

| 実行主体 | AWS task role | PostgreSQL role | 主なDB権限 |
|---|---|---|---|
| API | API task role | `dojo_api` | challenge CRUD、submission insert/select、outbox insert/select/update |
| Worker | Worker task role | `dojo_worker` | challenge select、submission select/update |
| Migrator | Migrator task role | `dojo_migrator` | schema DDL、migration metadata |

DB master userをapplication taskへ渡さない。

## Network境界

### Subnet

- ALB: public subnet
- API / Worker / Migrator task: private application subnet
- RDS: private database subnet
- RDSへInternet Gateway経由のrouteを持たせない

### Security group

| Source | Destination | Port | 許可理由 |
|---|---|---:|---|
| ALB SG | API SG | application port | Public HTTP entry |
| API SG | DB SG | 5432 | API DB接続 |
| Worker SG | DB SG | 5432 | Worker DB接続 |
| Migrator SG | DB SG | 5432 | Migration実行時のみ |
| Worker SG | SQS endpoint / NAT | HTTPS 443 | SQS access |
| API SG | SQS endpoint / NAT | HTTPS 443 | SQS publish |

DB SGでCIDR広域許可や`0.0.0.0/0`を使用しない。

## Secret境界

### Secret構成

Secretはservice単位で分ける。

- `ai-code-dojo/<env>/db/api`
- `ai-code-dojo/<env>/db/worker`
- `ai-code-dojo/<env>/db/migrator`

推奨JSON key:

```json
{
  "username": "...",
  "password": "..."
}
```

DB endpoint、port、database name、SSL modeは通常environmentで管理する。

### ECSへの注入

- Secret取得はtask execution roleが担当する。
- Containerへは必要なJSON keyだけをenvironmentとして注入する。
- Application task roleへSecrets Manager readを付与しない。
- Secret値をlog、health response、error response、GitHub Actions summaryへ出さない。
- Rotation後はrunning taskが自動更新されないため、API / Worker serviceを順次redeployする。

## Database接続設定

Target configuration:

```text
DATABASE_PROVIDER=postgres
DATABASE_HOST=<rds endpoint>
DATABASE_PORT=5432
DATABASE_NAME=ai_code_dojo
DATABASE_USER=<secret injection>
DATABASE_PASSWORD=<secret injection>
DATABASE_SSL_MODE=verify-full
DATABASE_CA_PATH=/app/certs/rds-global-bundle.pem
DATABASE_POOL_MAX=<small positive integer>
DATABASE_POOL_IDLE_TIMEOUT_MS=<positive integer>
DATABASE_CONNECT_TIMEOUT_MS=<positive integer>
```

禁止事項:

- Passwordを含むconnection URLのlog出力
- TLS検証無効化
- Pool上限未設定
- API / Worker間で同一DB userを共有
- Startup時の自動DDL

## Connection pool

初回はapplication process内poolを使用する。

- API / Workerで別poolを持つ。
- `pool max × task desired count`の合計をDB connection budget内に収める。
- Migratorはmigration中だけconnectionを確保し、終了時にcloseする。
- Pool timeout、borrow failure、connection errorを構造化eventへ出すが、endpoint / credentialは出さない。
- RDS Proxyは初回対象外。Connection pressureをmetricsで確認してから導入する。

## Database adapter境界

Repositoryはdriver APIへ直接依存しない。

```text
Repository
   |
DatabaseClient interface
   +--> SQLite adapter（移行期間・local test）
   +--> PostgreSQL adapter（target runtime）
```

Contract:

- `queryOne`
- `queryMany`
- `execute`
- `transaction`
- `close`

Normalization:

- SQLite `changes` / PostgreSQL `rowCount` -> `rowCount`
- Driver row naming差異 -> snake_case row contract
- Placeholder -> `$n` canonical
- Transaction callback -> same connection
- Error -> generalized database error category

Repositoryから以下を除去する。

- `DatabaseSync`
- `.prepare().get()` / `.all()` / `.run()`
- `BEGIN IMMEDIATE`
- `PRAGMA`
- Driver固有error codeへの直接依存

## Schema互換方針

初回cutoverでは変更対象をdriver / runtimeへ限定する。

| Logical field | 初回PostgreSQL type | 理由 |
|---|---|---|
| ID / slug / key | `text` | 既存値と外部contractを維持 |
| Status / language | `text` + CHECK / application validation | 既存状態機械を維持 |
| Timestamp | UTC ISO 8601 `text` | JS row mappingとlexical comparisonを維持 |
| JSON payload | JSON serialized `text` | JSON parse / serialize contractを維持 |
| Attempt count | `integer` | 既存制約を維持 |

`uuid` / `jsonb` / `timestamptz`への変換は、初回cutover後に独立Issueで実施する。

## Correctness境界

### Transactional outbox

Submission insertとoutbox insertは同一PostgreSQL transaction / clientでcommitする。

- 片方だけ成功させない。
- Commit失敗時は両方rollbackする。
- Queue publish成功前はoutboxをpendingに維持する。

### Claim / heartbeat / completion

- `status`
- `completion_guard_at`
- `grading_attempt`
- `attempt_idempotency_key`
- `processing_lease_expires_at`

を条件付きUPDATEで検証し、`rowCount = 1`だけを成功とする。

### Stale recovery

- Candidate listはヒントであり、所有権確定ではない。
- Recovery transaction内でcurrent rowを再取得する。
- PostgreSQLでは`SELECT ... FOR UPDATE`で対象rowを固定する。
- Old attempt / key / lease expiryが一致しない場合はno-opにする。

### Outbox scale gate

現行pending listにはclaim / leaseがない。

- API desired countはoutbox claim / lease実装まで1を維持する。
- 複数dispatcherを有効化しない。
- 後続Issueで`FOR UPDATE SKIP LOCKED`または同等のlease contractを導入する。

## Deployment順序

1. Database adapter / dual-provider contract test
2. Versioned migration runner / PostgreSQL schema
3. Repository async化 / PostgreSQL port
4. Outbox claim / lease
5. RDS / secret / security group IaC
6. Export / import / validation tool
7. Staging DB provision
8. Staging cutover rehearsal
9. API / Worker / Migrator ECS wiring
10. HTTP transportのままstaging smoke test
11. 承認後にSQS transport検証

DB provider、ECS化、SQS切替を一度に行わない。

## Availability / backup

- Automated backupとPITRを有効にする。
- Manual snapshotをdestructive migration前に取得する。
- DB resourceにはDeletionPolicy / UpdateReplacePolicy相当の保護を設定する。
- Restore testを実施していないbackupを運用完了とみなさない。

## Observability

最低限記録する項目:

- service
- operation category
- outcome
- generalized error type
- transaction retry count
- pool waiting / timeout count
- migration version / duration
- DB failover / connection reset count

記録しない項目:

- DB password
- Full connection string
- RDS endpointをlearner responseへ返すこと
- SQL parameterに含まれるsubmitted code
- Hidden tests

## 現時点の非対象

- RDS / ECS resource作成
- PostgreSQL driver導入
- Repository実装変更
- Secret作成
- Production cutover
- RDS Proxy
- IAM DB authentication
- JSONB / timestamptz最適化

## 参照

- ADR: `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- Migration design: `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- Risk register: `docs/risks/2026-08-01-managed-db-migration-risks.md`
- Cutover draft: `docs/runbooks/2026-08-01-sqlite-postgresql-cutover-draft.md`
