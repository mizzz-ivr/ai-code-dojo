# system-overview（正本）

最終更新: 2026-08-01（Issue #131 Managed DB / ECS topology設計を反映）

## この文書の目的

実装詳細に入る前に、現行システムの境界・責務分担・データフロー・correctness境界と、Issue #131で確定したManaged DB移行後の目標構成を把握できるようにする。

設計済みの将来構成と実装済みruntimeを混同しないことを最優先とする。

## 状態区分

### 実装済み・現行runtime

- Database: SQLite `.data/app.db`
- API / Worker: Node.js process
- API queue producer: HTTP / SQS切替可能、既定HTTP
- Worker queue consumer: HTTP / SQS切替可能、既定HTTP
- Transactional outbox
- Processing lease / heartbeat
- Attempt idempotency key / completion guard
- Stale running recovery
- Worker-origin retry / recoveryのruntime `enqueue()`統合
- SQS source queue / DLQ / IAMのCloudFormation IaC
- Staging OIDC review-only change set workflow

### 設計確定・未実装

- Amazon RDS for PostgreSQL
- Async DatabaseClient adapter
- Versioned migration runner
- API / Worker別ECS service / task definition
- One-shot DB Migrator task
- API / Worker / Migrator別PostgreSQL role / secret
- SQLite export / PostgreSQL import / validation tool
- Staging cutover rehearsal

## システム境界

- 学習者: Web UIから問題取得・提出・結果確認
- Web: 学習者向け画面とAPI client
- API: Challenge / submission / adminの公開境界、認可、submission永続化、採点依頼
- Database: Challenge、submission、queue outbox、lease / fencing状態の正本
- Transactional outbox: Submissionとqueue publish intentのatomic永続化、pending publish再送
- Queue contract / port: Version付きmessage、producer / consumer共通validation、transport差し替え境界
- API queue runtime: HTTP / SQS producer選択、legacy / outbox共通enqueue
- Worker queue runtime: HTTP / SQS consumer選択、long polling、visibility、ack、Worker-origin requeue
- SQS infrastructure: Source queue、DLQ、RedrivePolicy、TLS deny、workload IAM role
- Worker: Claim、Runner実行、DB heartbeat、application retry、stale recovery、結果保存
- Runner: Visible / hidden tests実行と結果正規化
- DLQ: Queue delivery異常の隔離。Submission `infra_failed`とは別概念
- Queue observability: Allowlist fieldのJSON Lines event、将来metrics / alertへ変換する監視契約
- Migrator（将来）: Versioned schema migrationをone-shotで実行する専用主体

## 現行高レベルデータフロー

1. WebがAPIからpublished challengeを取得する。
2. WebがAPIへsubmissionを作成する。
3. Outbox有効時はAPIがsubmissionとqueue publish intentを同一SQLite transactionで保存する。
4. Outbox dispatcherがpending messageをAPI queue runtimeへ渡す。
5. `API_QUEUE_TRANSPORT=http`ではWorker `POST /jobs`へ送信する。
6. `API_QUEUE_TRANSPORT=sqs`ではsource queueへSendMessageする。
7. `WORKER_QUEUE_CONSUMER=http`では`POST /jobs`を共通message contractで検証する。
8. `WORKER_QUEUE_CONSUMER=sqs`ではsource queueを1件ずつlong pollingする。
9. Workerがsubmissionをattempt / key / completion guard条件付きでclaimする。
10. Processing中はDB leaseをheartbeatし、SQS経路ではqueue visibilityもbest-effort延長する。
11. Runnerがvisible / hidden testsを実行する。
12. Workerがexpected attempt / keyとcompletion guardで結果を保存する。
13. DB terminal保存、retry処理完了、安全なno-op確認後だけSQS messageをDeleteMessageする。
14. Invalid message、unexpected error、ownership喪失、保存未確認ではmessageを削除しない。
15. Infrastructure failure時はnew attemptを作成し、Worker runtime `enqueue()`へ渡す。
16. Processing lease期限切れ時はstale recoveryがnew attemptへ回収し、注入されたruntime `enqueue()`へ渡す。
17. 未削除messageはvisibility expiry後に再配送され、RedrivePolicy上限でDLQへ移る。
18. Webがsubmission結果をポーリング表示する。

## 現行Database境界

### Provider

- `node:sqlite`の`DatabaseSync`を使用する。
- DB fileはprocess working directory配下の`.data/app.db`。
- Module-level singleton connectionを使用する。
- Startup時にschema作成、additive column確認、legacy JSON importを行う。

### SQLite固有依存

- Sync `.prepare().get()` / `.all()` / `.run()`
- `?` placeholder
- `write.changes`
- `PRAGMA table_info`
- `BEGIN IMMEDIATE`
- File path / local filesystem

これらはRepositoryからasync DatabaseClient境界へ移すまで、ECSの複数task運用へ持ち込まない。

### データ管理

- Challenge: `challenges` + `challenge_versions`
- Submission: `submissions`
- Queue publish intent: `queue_outbox`
- Submission内部制御:
  - `grading_attempt`
  - `attempt_idempotency_key`
  - `completion_guard_at`
  - `processing_claimed_at`
  - `processing_heartbeat_at`
  - `processing_lease_expires_at`

Queue delivery state、ReceiptHandle、delivery countはsubmission tableへ保存しない。

## Queue message contract

Schema version 1は次の参照情報だけを許可する。

- `schemaVersion = 1`
- `submissionId`
- `gradingAttempt`
- `attemptIdempotencyKey`
- Optional `correlationId`

Producer / consumerは`packages/queue/src/message-contract.mjs`の同一parserを利用する。

拒否対象:

- 未対応schema version
- 必須field欠落
- 不正型・空文字・0以下のattempt
- 未知field
- 不正JSON

Messageへ含めないもの:

- 提出コード本文
- Visible / hidden tests詳細
- Challenge本文
- Secret / token / password
- QueueUrl / ReceiptHandle
- Learnerへ不要な内部障害詳細

Transport publish / deliveryではgrading attemptとattempt idempotency keyを変更しない。

## API queue runtime

### Transport選択

- `API_QUEUE_TRANSPORT=http|sqs`
- 既定値は`http`
- HTTP選択時はAWS clientを生成しない
- SQS選択時は`API_QUEUE_OUTBOX_ENABLED=1`を必須とする

### SQS producer設定

- `API_SQS_REGION`
- `API_SQS_QUEUE_URL`
- `API_SQS_QUEUE_TYPE=standard|fifo`

QueueUrlはabsolute HTTPS URLとし、credentials、query、fragmentを許可しない。FIFO指定時はqueue nameを`.fifo`で終える。

### Lifecycle

- API process単位で1つのSQS clientを生成する。
- Legacy enqueueとoutbox dispatcherで共有する。
- API終了時にclientをbest-effort destroyする。
- CredentialsはAWS SDK default credential provider chainへ委譲する。
- SendMessage失敗時はoutboxをpendingに維持する。

## Worker queue runtime

### Transport選択

- `WORKER_QUEUE_CONSUMER=http|sqs`
- 既定値は`http`
- HTTP `POST /jobs`をrollback先として維持する
- HTTP選択時はAWS clientを生成しない

### SQS設定

SQS選択時に起動前検証する。

- `WORKER_SQS_REGION`
- `WORKER_SQS_QUEUE_URL`
- `WORKER_SQS_WAIT_TIME_SECONDS`: 1〜20
- `WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS`: 1〜43200
- `WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS`: Visibility timeoutの3分の1以下
- `WORKER_SQS_POLL_ERROR_DELAY_MS`: Optional positive safe integer

QueueUrl末尾が`.fifo`ならFIFO、それ以外はStandardとして扱う。QueueUrlへcredentials、query、fragmentを含めない。

### Receive / visibility / ack

ReceiveMessage:

- `MaxNumberOfMessages = 1`
- Configured `WaitTimeSeconds`
- Configured `VisibilityTimeout`
- `AttributeNames = ApproximateReceiveCount`

Processing中は設定intervalでChangeMessageVisibilityをbest-effort実行する。Queue visibilityはdelivery availability、DB processing leaseはcurrent attemptの実行所有権を担う。

DeleteMessageする条件:

- Terminal結果をfenced updateで保存できた
- Infrastructure failureをnew attempt enqueueまたは終端化まで処理できた
- Submission不存在、旧attempt、duplicate / terminal / 他Worker所有を安全なno-opとして確認した

DeleteMessageしない条件:

- Invalid JSON / invalid contract
- Unexpected processing error
- DB lease ownership喪失
- Terminal保存未確認
- Retry状態遷移・enqueue・終端化未確認
- DeleteMessage失敗

## Worker-origin requeue（Issue #129 / PR #130）

### 対象

- Application retry
- Stale running recovery

### Runtime接続

1. Worker runtimeが選択transportのproducerを保持し、`enqueue()` portを公開する。
2. Application retryはserverからruntime `enqueue()`を直接呼ぶ。
3. Stale scanner起動時にruntime `enqueue()`を`enqueueAttempt`として明示注入する。
4. Runtime `enqueue()`が共通`enqueueSubmissionAttempt`へproducerを明示してmessageを渡す。
5. Process-global registrationや共有可変singletonは使用しない。
6. SQS shutdown時はpoll停止後にclientをdestroyする。

HTTP:

- `WORKER_RETRY_ENQUEUE_BASE_URL`の`POST /jobs`へ再投入する。
- 未指定時は`http://localhost:8081`を使用する。

SQS:

- Consumerとretry producerで同一SQS client / region / QueueUrlを共有する。
- Source queueへSendMessageする。
- FIFO時は既存SQS producerのSHA-256 MessageGroupId / MessageDeduplicationId契約を再利用する。

### Failure contract

- Enqueue成功時だけretry / recovery完了とする。
- Enqueue失敗時はnew attemptを条件付きで`infra_failed`へ終端化する。
- Raw SDK error messageは記録せず、一般化reasonとerror typeだけをeventへ出す。
- Attempt / key / completion guard条件が不一致なら成功扱いにしない。

## SQS infrastructure

### Source queue / DLQ

- Standard / FIFOを同一templateで選択する。
- Source / DLQのtypeを一致させる。
- Source retention 4日、long polling 20秒、visibility 90秒。
- DLQ retention 14日、`RedriveAllowPolicy=byQueue`。
- `MaxReceiveCount`既定値5。
- Source / DLQでSQS-managed SSEを有効化する。
- TLSでないaccessを明示的に拒否する。
- Source / DLQへDeletionPolicy / UpdateReplacePolicy Retainを設定する。

### Runtime IAM

API producer role:

- Source queueの`sqs:SendMessage`だけ。

Worker role:

- Source queueの`sqs:ReceiveMessage`
- Source queueの`sqs:DeleteMessage`
- Source queueの`sqs:ChangeMessageVisibility`
- Source queueの`sqs:SendMessage`

付与しないもの:

- Wildcard resource
- Managed policy
- DLQ read
- PurgeQueue
- Queue作成・削除・属性変更
- 固定RoleName

Customer managed KMSを採用する場合、Worker role policy例は対象keyの`kms:Decrypt` / `kms:GenerateDataKey`を含む。現行既定はSQS-managed SSE。

## Transactional outbox

- Submissionと同じattemptのqueue messageを`queue_outbox`へpending保存する。
- Submissionとoutboxを同一Database transactionでcommitする。
- 現行SQLiteでは`BEGIN IMMEDIATE`を使用する。
- Target PostgreSQLでは同じtransaction clientを使用する。
- Dispatcherが選択されたAPI producer runtimeへmessageを渡す。
- Enqueue成功時だけpublishedへ更新する。
- Enqueue失敗時はpendingを維持する。
- Duplicate publishを許容し、Worker DB fencingで無害化する。

## Delivery・correctness境界

| 機構 | 主責務 | Correctnessへの位置付け |
|---|---|---|
| CloudFormation stack | Queue / IAM / DB resourceの再現性 | 運用基盤 |
| Transactional outbox | Publish intentのdurability | 必須transaction境界 |
| SQS durable message | Delivery availability | 補助 |
| Queue visibility timeout | 一時的な再配送抑止 | 補助 |
| DB processing lease | Current attemptの実行所有権 | 必須 |
| Attempt idempotency key | Attempt fencing | 必須 |
| Completion guard | Terminal保存の一意化 | 必須 |
| Conditional UPDATE row count | Ownership /保存成功判定 | 必須 |

Exactly-once publish / deliveryやFIFO deduplicationだけへ正しさを依存しない。

## Managed DB目標構成（Issue #131）

### Database

- Amazon RDS for PostgreSQL provisioned
- Private database subnet
- `PubliclyAccessible=false`
- Storage encryption
- Automated backup / PITR
- Deletion protection
- Production相当はMulti-AZ
- TLS certificate verification必須

Exact PostgreSQL version、staging Multi-AZ、pool sizeは後続IaC / adapter Issueで確定する。

### ECS topology

```text
ALB
 |
API ECS Service / API Task Role
 |                       \
 | PostgreSQL TLS         \ SendMessage
 v                         v
RDS PostgreSQL <------- Source SQS Queue
 ^                         |
 | PostgreSQL TLS          | Receive / Visibility / Delete
 |                         v
Worker ECS Service / Worker Task Role

DB Migrator one-shot ECS Task
 |
 +--> versioned schema migration
```

API / Workerを同一taskへ同居させない。

### Service responsibility

API service:

- Public HTTP API
- Challenge / submission / admin
- Submission + outbox atomic write
- Outbox dispatch
- Queue producer

Worker service:

- Queue consume
- Submission claim / heartbeat / completion
- Runner呼び出し
- Retry / stale recovery

Migrator task:

- Versioned schema migration
- Migration checksum検証
- Advisory lock
- DDL

API / Worker startupでmigrationを実行しない。

### AWS IAM / PostgreSQL role

| 主体 | AWS task role | PostgreSQL role |
|---|---|---|
| API | API専用。Source queue SendMessageのみ | `dojo_api` |
| Worker | Worker専用。Source queue Receive / Delete / Visibility / Send | `dojo_worker` |
| Migrator | Migration実行に必要な限定権限 | `dojo_migrator` |

AWS task roleとPostgreSQL roleは別の防御層として扱う。ApplicationへDB master credentialやDDL権限を渡さない。

### Secret / execution role

- API / Worker / Migratorで別Secrets Manager secretを使用する。
- ECS task definitionの`secrets`から必要なkeyだけを注入する。
- Secret取得はtask execution roleが担当する。
- Application task roleへ不要なSecrets Manager readを付与しない。
- Secret rotation後はrunning taskへ自動反映されないため、rolling redeployを必須とする。
- Initial authenticationはpassword方式とし、IAM DB authenticationは別Issueで再評価する。

### Network

- ALBはpublic subnet。
- API / Worker / Migratorはprivate application subnet。
- RDSはprivate database subnet。
- DB SGはAPI SG / Worker SG / Migrator SGからのTCP 5432だけを許可する。
- CIDR広域許可やInternet公開を行わない。

### Database adapter

Repositoryからdriver固有APIを除去し、次のasync contractを利用する。

- `queryOne(statement, params)`
- `queryMany(statement, params)`
- `execute(statement, params)`
- `transaction(callback)`
- `close()`

Normalization:

- Canonical placeholder: `$1`, `$2`, ...
- SQLite `changes` / PostgreSQL `rowCount`: `{ rowCount }`
- Transaction callback: 同一connection
- Driver固有error: internal categoryへ一般化

Initial migrationではORM / query builderを同時導入しない。

### Schema compatibility

初回cutoverでは既存application contractを維持する。

- ID / slug / attempt key: text
- JSON payload: serialized text
- Timestamp: UTC ISO 8601 text
- Counter: integer

`uuid` / `jsonb` / `timestamptz`への変換はcutover後の別Issueとする。

### PostgreSQL concurrency

- Claim / heartbeat / completionは条件付きUPDATEの`rowCount = 1`だけを成功とする。
- Stale recoveryはtransaction内でcurrent rowを`SELECT ... FOR UPDATE`する。
- Challenge version追加はchallenge row lockまたはunique violation retryを利用する。
- Candidate list取得だけをownership取得とみなさない。

### Scale gate

現行outbox dispatcherにはclaim / leaseがない。

- Outbox claim / lease完了前はAPI desired countを1に固定する。
- 複数dispatcherを有効化しない。
- Follow-upで`FOR UPDATE SKIP LOCKED`または明示leaseを導入する。

### Cutover gate

初回SQLite -> PostgreSQL cutoverは短時間maintenance方式とする。

1. New write停止
2. Running処理完了
3. API / Worker停止
4. SQLite backup / hash
5. Deterministic export
6. PostgreSQL migration / import
7. Row / invariant validation
8. HTTP transportのままAPI / Worker起動
9. Smoke test
10. 承認後にwrite再開

Write再開前はSQLite backupへ戻せる。Write再開後はPostgreSQLへnew dataが発生するため、SQLiteへの単純切戻しを禁止する。

## ECS implementation gate

Issue #131でdesign blockerは解消するが、ECS resource実装は次の依存が完了するまでBlockedとする。

1. DB adapter / dual-provider contract test
2. Versioned migration runner / PostgreSQL schema
3. Repository async port
4. Outbox claim / lease
5. RDS / secret / network IaC
6. Export / import / validation tool
7. Staging cutover rehearsal

SQLite fileをEFSで共有する案、API / Worker同一task案は採用しない。

## DLQ

- DLQはqueue delivery異常を通常配送から隔離するinternal queue。
- Learner codeの通常failure、test failure、terminal duplicate、旧attemptをDLQ理由としない。
- Invalid schema、未対応version、繰り返すconsumer / DB障害を隔離候補とする。
- DLQとsubmission `infra_failed`を分離する。
- Replay前にsubmission status、completion guard、attempt、keyを再検証する。
- Replay / purge API・UIは未実装。

## Observability

Event contractは`packages/queue/src/queue-event-logger.mjs`を正本とする。

記録可能なcontext例:

- Transport / provider / source / outcome / reason
- MessageId / delivery count
- Submission ID / grading attempt
- Correlation ID / schema version
- Generalized error type
- DB operation category / transaction retry count
- Pool waiting / timeout count
- Migration version / duration

禁止field:

- 提出コード
- Visible / hidden tests
- Credentials / credential source
- Attempt idempotency key
- QueueUrl
- ReceiptHandle
- DB password / full connection string
- Raw error message

Logger failureはqueue処理・採点・recoveryへ例外を伝播しない。

## Deployment control plane

- GitHub OIDC deployment roleとCloudFormation execution roleを分離する。
- OIDC trustは`aud` / `sub`を完全一致させる。
- Staging GitHub Environment protectionを併用する。
- Review-only workflowはValidateTemplate、CreateChangeSet、Describeまで行う。
- Change setをexecuteしない。
- PR CIから実AWS resourceを作成しない。
- Production transportはHTTPのまま。
- DB cutoverとSQS transport切替を同じchange windowへ含めない。

## セキュリティ境界

- Learner-safeとinternalレスポンスを分離する。
- Hidden tests詳細はlearnerへ非公開。
- `/api/admin/*`はadmin role必須。
- Attempt key、lease、heartbeat、queue / outbox / DLQ / database stateをlearnerへ返さない。
- QueueUrl、account ID、credential、ReceiptHandle、message bodyをRepositoryへ保存しない。
- API本体で提出コードを直接実行しない。
- Challenge編集はversion追加方式とする。
- API / Worker / MigratorでAWS IAM、DB user、secretを分離する。
- DBはprivate network / TLS検証を必須とする。
- Submitted code / hidden testsを含むmigration artifactをpublic CIへuploadしない。

## 現時点の未対応

- PostgreSQL adapter / driver
- Versioned migration runner / PostgreSQL schema
- Repository async port
- Outbox claim / lease
- RDS / Secrets Manager / DB SG IaC
- SQLite export / PostgreSQL import / validation tool
- API / Worker / Migrator ECS task / service
- Staging cutover rehearsal
- Actual AWS OIDC bootstrap / stack operation
- Production SQS transport切替
- VPC endpoint
- Customer managed KMS key本体
- DLQ replay / purge
- Metrics backend / dashboard / alert
- Durable retry scheduling
- RDS Proxy / IAM DB authentication
- Production-grade Runner isolation

## 詳細文書

- 現在状態: `docs/current-status.md`
- 進行中Issue: `docs/active-issues.md`
- Managed DB ADR: `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- Managed DB topology: `docs/architecture/managed-db-ecs-topology.md`
- SQLite -> PostgreSQL migration: `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- Managed DB risks: `docs/risks/2026-08-01-managed-db-migration-risks.md`
- Cutover draft: `docs/runbooks/2026-08-01-sqlite-postgresql-cutover-draft.md`
- Worker-origin requeue: `docs/architecture/worker-origin-requeue.md`
- Worker retry runbook: `docs/runbooks/2026-07-31-worker-retry-queue-runtime-runbook.md`
- SQS infrastructure: `docs/runbooks/2026-07-28-sqs-cloudformation-infra-runbook.md`
- GitHub OIDC staging: `docs/runbooks/2026-07-30-github-oidc-staging-change-set-runbook.md`
- Queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
