# system-overview（正本）

最終更新: 2026-07-31（Issue #129 Worker-origin requeue runtimeを反映）

## この文書の目的

実装詳細に入る前に、システム境界・責務分担・データフロー・correctness境界を把握するためのアーキテクチャ概観を提供する。

## システム境界

- 学習者: Web UIから問題取得・提出・結果確認
- API: Challenge / submission / adminの公開境界、認可、submission永続化、採点依頼
- Transactional outbox: Submissionとqueue publish intentのatomic永続化、pending publish再送
- Queue contract / port: Version付きmessage、producer / consumer共通validation、transport差し替え境界
- API queue runtime: HTTP / SQS producer選択、legacy / outbox共通enqueue
- Worker queue runtime: HTTP / SQS consumer選択、long polling、visibility、ack、Worker-origin requeue
- SQS infrastructure: Source queue、DLQ、RedrivePolicy、TLS deny、workload IAM role
- Worker: Claim、Runner実行、DB heartbeat、application retry、stale recovery、結果保存
- Runner: Visible / hidden tests実行と結果正規化
- DLQ: Queue delivery異常の隔離。Submission `infra_failed`とは別概念
- Queue observability: Allowlist fieldのJSON Lines event、将来metrics / alertへ変換する監視契約

## 高レベルデータフロー

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
15. Infrastructure failure時はnew attemptを作成し、選択中Worker queue runtimeへ再投入する。
16. Processing lease期限切れ時はstale recoveryがnew attemptへ回収し、選択中runtimeへ再投入する。
17. 未削除messageはvisibility expiry後に再配送され、RedrivePolicy上限でDLQへ移る。
18. Webがsubmission結果をポーリング表示する。

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

1. Worker runtime作成時にprocess-local default producer factoryを登録する。
2. Existing retry / stale recoveryは共通`enqueueSubmissionAttempt`を呼ぶ。
3. 共通入口が登録済みHTTP / SQS producerへmessageを渡す。
4. Runtime close時にregistrationをrestoreする。

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
- Submissionとoutboxを同一SQLite transactionでcommitする。
- Dispatcherが選択されたAPI producer runtimeへmessageを渡す。
- Enqueue成功時だけpublishedへ更新する。
- Enqueue失敗時はpendingを維持する。
- Duplicate publishを許容し、Worker DB fencingで無害化する。

## Delivery・correctness境界

| 機構 | 主責務 | Correctnessへの位置付け |
|---|---|---|
| CloudFormation stack | Queue / IAM resourceの再現性 | 運用基盤 |
| Transactional outbox | Publish intentのdurability | 補助 |
| SQS durable message | Delivery availability | 補助 |
| Queue visibility timeout | 一時的な再配送抑止 | 補助 |
| DB processing lease | Current attemptの実行所有権 | 必須 |
| Attempt idempotency key | Attempt fencing | 必須 |
| Completion guard | Terminal保存の一意化 | 必須 |

Exactly-once publish / deliveryやFIFO deduplicationだけへ正しさを依存しない。

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

禁止field:

- 提出コード
- Visible / hidden tests
- Credentials / credential source
- Attempt idempotency key
- QueueUrl
- ReceiptHandle
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

## ECS deployment blocker

現行DBはprocess working directory配下の固定SQLite `.data/app.db`。

- API / Workerを別ECS taskへ分離するとDB fileを共有できない。
- API / Workerを同一taskへ同居させるとtask roleが共通になり、API producer / Worker roleの最小権限分離を維持できない。
- Managed DB移行または実行トポロジー確定前にECS task definition / service wiringを実装しない。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## データ管理

- Challenge: `challenges` + `challenge_versions`
- Submission: `submissions`
- Queue publish intent: `queue_outbox`
- 永続化: SQLite `.data/app.db`
- Submission内部制御:
  - `grading_attempt`
  - `attempt_idempotency_key`
  - `completion_guard_at`
  - `processing_claimed_at`
  - `processing_heartbeat_at`
  - `processing_lease_expires_at`

Queue delivery state、ReceiptHandle、delivery countはsubmission tableへ保存しない。

## セキュリティ境界

- Learner-safeとinternalレスポンスを分離する。
- Hidden tests詳細はlearnerへ非公開。
- `/api/admin/*`はadmin role必須。
- Attempt key、lease、heartbeat、queue / outbox / DLQ stateをlearnerへ返さない。
- QueueUrl、account ID、credential、ReceiptHandle、message bodyをRepositoryへ保存しない。
- API本体で提出コードを直接実行しない。
- Challenge編集はversion追加方式とする。

## 現時点の未対応

- 実AWS OIDC bootstrap / SQS stack operation
- Production SQS transport切替
- Managed DB移行
- ECS task definition / service / cluster
- VPC endpoint / network path
- Customer managed KMS key本体
- DLQ replay / purge
- Metrics backend / dashboard / alert
- Outbox claim / lease
- Durable retry scheduling
- Production-grade Runner isolation

## 詳細文書

- 現在状態: `docs/current-status.md`
- 進行中Issue: `docs/active-issues.md`
- Worker-origin requeue: `docs/architecture/worker-origin-requeue.md`
- Worker retry runbook: `docs/runbooks/2026-07-31-worker-retry-queue-runtime-runbook.md`
- SQS infrastructure: `docs/runbooks/2026-07-28-sqs-cloudformation-infra-runbook.md`
- GitHub OIDC staging: `docs/runbooks/2026-07-30-github-oidc-staging-change-set-runbook.md`
- Queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
