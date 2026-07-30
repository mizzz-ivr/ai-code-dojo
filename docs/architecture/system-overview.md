# system-overview（正本）

最終更新: 2026-07-28（Issue #125 SQS CloudFormation infrastructureを反映）

## この文書の目的

実装詳細に入る前に、システム境界・責務分担・データフローを把握するためのアーキテクチャ概観を提供する。

## システム境界

- 学習者: Web UIから問題取得・提出・結果確認
- API: challenge/submission/adminの公開境界、認可制御、submission永続化、採点依頼
- Transactional outbox: submissionとqueue publish intentのatomic永続化、pending publish再送
- Queue contract / port: version付きmessage、producer / consumer共通validation、transport差し替え境界
- API queue runtime: HTTP / SQS producer選択、producer lifecycle、legacy / outbox共通enqueue
- Worker queue runtime: HTTP / SQS consumer選択、long polling、visibility、ack lifecycle
- SQS infrastructure: Source queue、DLQ、RedrivePolicy、TLS deny、workload IAM role
- DLQ: queue delivery異常の隔離。Submission `infra_failed`とは別概念
- Queue observability: allowlist fieldのJSON Lines event、将来metrics / alertへ変換する監視契約
- Worker: 採点ジョブのclaim、実行、DB heartbeat、application retry、stale scanner、結果保存、障害回復
- Runner: テスト実行と結果正規化

## 高レベル構成

1. WebがAPIからchallengeを取得する。
2. WebがAPIにsubmissionを作成する。
3. Outbox無効時はAPIがsubmissionを保存後、queue runtimeへ同期enqueueする。
4. Outbox有効時はAPIがsubmissionとqueue publish intentを同一SQLite transactionで保存する。
5. Outbox dispatcherがpending messageをAPI queue runtimeへ渡す。
6. `API_QUEUE_TRANSPORT=http`ではHTTP adapterがWorker `POST /jobs`へ通知する。
7. `API_QUEUE_TRANSPORT=sqs`ではSQS producerがsource queueへ`SendMessage`する。
8. `WORKER_QUEUE_CONSUMER=http`ではWorkerが`POST /jobs`を共通message contractで検証する。
9. `WORKER_QUEUE_CONSUMER=sqs`ではWorkerがsource queueを一件ずつlong pollingする。
10. SQS deliveryはenvelopeとBodyを検証し、valid messageだけを既存submission処理へ渡す。
11. WorkerがDB上のsubmissionをattempt / key / completion guard条件付きでclaimする。
12. 採点中はDB processing leaseをheartbeatし、SQS経路ではqueue visibilityもbest-effort延長する。
13. WorkerがRunnerでvisible / hidden testsを実行する。
14. Infrastructure failure時はretry上限を確認し、new attempt作成・再enqueueまたは終端化する。
15. Workerがexpected attempt / keyとcompletion guardで結果を保存する。
16. DBの永続処理または安全なno-op確認後だけSQS messageを`DeleteMessage`する。
17. Invalid message、unexpected error、所有権喪失、保存未確認ではmessageを削除しない。
18. 未削除messageはvisibility expiry後に再配送され、resource側RedrivePolicyの上限到達時にDLQへ移る。
19. Webがsubmission結果をポーリング表示する。

## Queue message contract（Issue #111 / PR #112）

### Schema version 1

Queue messageは次の参照情報だけを持つ。

- `schemaVersion = 1`
- `submissionId`
- `gradingAttempt`
- `attemptIdempotencyKey`
- Optional `correlationId`

Producer / consumerは `packages/queue/src/message-contract.mjs` の同一parserを利用する。

拒否対象:

- 未対応schema version
- 必須field欠落
- 不正型・空文字・0以下のattempt
- 未知field
- 不正JSON

Messageへ次を含めない。

- 提出コード本文
- Visible / hidden tests詳細
- Challenge本文
- Secret / token / password
- Learnerへ不要な内部障害詳細

Transport publish / deliveryではgrading attemptやattempt idempotency keyを変更しない。

## API queue runtime（Issue #121 / PR #122）

### Transport選択

- `API_QUEUE_TRANSPORT`は`http`または`sqs`を許可する。
- 既定値は`http`とし、既存動作とrollback経路を維持する。
- HTTP選択時はSQS関連設定を参照せず、AWS clientを生成しない。
- SQS選択時は`API_QUEUE_OUTBOX_ENABLED=1`を必須とする。

### SQS producer設定

- `API_SQS_REGION`
- `API_SQS_QUEUE_URL`: absolute HTTPS URL
- `API_SQS_QUEUE_TYPE`: `standard`または`fifo`
- QueueUrlにcredentials、query、fragmentを含めない
- FIFO指定時はqueue nameが`.fifo`で終わる
- Standard指定時は`.fifo` queueを拒否する

### Producer lifecycle

- API process単位で一つの`SQSClient`を生成・再利用する。
- Legacy enqueueとoutbox dispatcherは同じruntimeを利用する。
- API終了時に`destroy()`をbest-effortで呼び出す。
- CredentialsはAWS SDK v3のdefault credential provider chainへ委譲する。
- Credentials不足やSendMessage失敗時はoutboxをpendingに維持する。

## Worker queue consumer runtime（Issue #123 / PR #124）

### Transport選択

- `WORKER_QUEUE_CONSUMER`は`http`または`sqs`を許可する。
- 既定値は`http`とする。
- HTTP選択時はSQS consumer clientを生成しない。
- HTTP `POST /jobs`をrollback先として維持する。

### SQS consumer設定

SQS選択時に次を起動前に検証する。

- `WORKER_SQS_REGION`
- `WORKER_SQS_QUEUE_URL`: absolute HTTPS URL
- `WORKER_SQS_WAIT_TIME_SECONDS`: 1〜20
- `WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS`: 1〜43200
- `WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS`: 正の整数かつvisibility timeoutの3分の1以下
- `WORKER_SQS_POLL_ERROR_DELAY_MS`: Optional positive safe integer

QueueUrlにcredentials、query、fragmentを含めず、queue nameを必須とする。

### Receive contract

`ReceiveMessage`は次のinputを使用する。

- `MaxNumberOfMessages = 1`
- Configured `WaitTimeSeconds`
- Configured `VisibilityTimeout`
- `AttributeNames = ApproximateReceiveCount`

Message envelopeでは`MessageId`、`ReceiptHandle`、`Body`を必須とする。BodyをJSON parse後、共通message parserで検証する。

### Visibility extension

- Processing中は設定intervalで`ChangeMessageVisibility`をbest-effort実行する。
- Queue visibility timeoutはdelivery availabilityを担う。
- DB processing leaseはcurrent attemptの実行所有権とcorrectnessを担う。
- Visibility延長失敗だけではDB結果保存を抑止しない。
- DB heartbeat失敗・所有権喪失時は結果保存とackを抑止する。

### Ack contract

`DeleteMessage`する条件:

- Terminal結果をfenced updateで保存できた
- Infrastructure failureをnew attempt enqueueまたは終端化まで処理できた
- Submission不存在を安全なno-opとして確認した
- Attempt mismatchを旧messageとして確認した
- Conditional claim失敗をduplicate / terminal / 他Worker所有の安全なno-opとして確認した

`DeleteMessage`しない条件:

- Invalid JSON / invalid contract
- Unexpected processing error
- DB processing lease所有権喪失
- Terminal保存未確認
- Retry状態遷移・new attempt・enqueue・終端化未確認
- DeleteMessage失敗

DeleteMessageには、そのdeliveryで受信した最新ReceiptHandleを使用する。ReceiptHandleはeventへ出さない。

### Client lifecycle

- Worker process単位で一つのSQS clientを生成・再利用する。
- Worker close時はpolling停止とclient destroyをbest-effortで行う。
- Receive失敗は一般化eventを記録し、設定delay後に再試行する。

## SQS CloudFormation infrastructure（Issue #125 / PR #126）

### Template

- `infra/aws/cloudformation/sqs-queue-stack.json`を正本とする。
- CloudFormation JSONを採用し、Terraform / CDK依存を追加しない。
- `QueueType=standard|fifo`をparameter化する。
- Source queueとDLQは同じtypeとする。
- FIFO時はsource / DLQ双方のqueue名を`.fifo`で終える。
- `WorkloadServicePrincipal`の既定値は`ecs-tasks.amazonaws.com`とする。
- RoleNameを固定せず、stack operationで`CAPABILITY_IAM`を指定する。

### Source queue

- SQS-managed SSEを有効化する。
- Message retentionは4日とする。
- Long pollingは20秒とする。
- Visibility timeoutは90秒とする。
- `MaxReceiveCount`の既定値は5とする。
- DLQ ARNを`RedrivePolicy.deadLetterTargetArn`へ指定する。

### DLQ

- SQS-managed SSEを有効化する。
- Message retentionは14日とする。
- `RedriveAllowPolicy.redrivePermission=byQueue`とする。
- Source queue ARNだけを`sourceQueueArns`へ指定する。
- Source queue ARNは決定的なqueue名から構築し、source→DLQ参照との循環依存を避ける。

### Queue policy

- Source / DLQ双方へ同じqueue policyを適用する。
- `aws:SecureTransport=false`の場合は全SQS actionを明示的に拒否する。
- Cross-account allowやanonymous allowを追加しない。

### Producer / consumer role

Producer role:

- Trust principalはparameter化する。
- Source queueへの`sqs:SendMessage`だけを許可する。

Consumer role:

- Trust principalはparameter化する。
- Source queueへの以下だけを許可する。
  - `sqs:ReceiveMessage`
  - `sqs:DeleteMessage`
  - `sqs:ChangeMessageVisibility`

付与しないもの:

- Wildcard resource
- Managed policy
- DLQ read
- PurgeQueue
- Queue作成・削除・属性変更
- 固定RoleName

### Lifecycle

- Source / DLQへ`DeletionPolicy=Retain`を設定する。
- Source / DLQへ`UpdateReplacePolicy=Retain`を設定する。
- Stack削除後もqueueは残るため、明示cleanupをrunbookで管理する。
- Standard / FIFO変更はreplacementになるため、同一stackの直接切替ではなく別stackで段階移行する。
- Runtime transport切替とresource deployを同一changeへ混在させない。

### Outputs

- Source QueueUrl / QueueArn
- DLQ QueueUrl / QueueArn
- Producer RoleArn
- Consumer RoleArn
- API非secret runtime設定例
- Worker非secret runtime設定例

QueueUrl / account ID実値はRepository、Issue、PR、docs、logsへ保存しない。

### Validation

通常CI:

- `pnpm infra:validate`
- AWS credentials不要
- JSON構文、resource、redrive、SSE、TLS、IAM、outputs、機微情報を検査
- App qualityの`infra-validation` jobとして実行
- Buildはinfra-validation成功を必須とする

実AWS確認:

- AWS CLI `validate-template`
- CREATE / UPDATE change set
- Change set差分レビュー
- 承認後のみexecute
- CIから実resourceを作成しない

## Transactional outbox（Issue #117 / PR #118）

### Atomic creation

- Submission rowと同じattemptのqueue messageを`queue_outbox`へ`pending`で保存する。
- 両方を同一SQLite transactionでcommitする。
- 途中失敗時はrollbackし、submissionだけを残さない。

### Dispatcher

- API起動時、submission作成直後、設定intervalでpending rowを取得する。
- 選択されたproducer runtimeへmessageを渡す。
- Enqueue成功時だけoutboxをpublishedへ更新する。
- Enqueue失敗時はpendingを維持する。
- Duplicate publishを許容し、Worker DB fencingで無害化する。

## Delivery・correctness境界

| 機構 | 主責務 | Correctnessへの位置付け |
|---|---|---|
| CloudFormation stack | Queue / IAM resourceの再現性 | 運用基盤 |
| Transactional outbox | Publish intentのdurability | 補助 |
| SQS durable message | Delivery availability | 補助 |
| Queue visibility timeout | 同一messageの一時的な再配送抑止 | 補助 |
| DB processing lease | Current attemptの実行所有権 | 必須 |
| Attempt idempotency key | Attempt単位のfencing | 必須 |
| Completion guard | Submission終端保存の一意化 | 必須 |

Exactly-once publish / deliveryやFIFO deduplicationだけへ正しさを依存しない。

## DLQ・RedrivePolicy

- DLQはqueue delivery異常を通常配送から隔離するinternal queueである。
- DLQ移送はsource queueのRedrivePolicyで設定し、consumerコードへmaxReceiveCountを固定しない。
- `maxReceiveCount=5`とDLQ retention 14日をCloudFormation既定値とする。
- Learner codeの通常failure、test failure、terminal済みduplicate、旧attempt、安全なattempt mismatchをDLQ理由としない。
- Invalid schema、未対応version、繰り返すconsumer / DB接続障害を隔離対象候補とする。
- DLQとsubmission `infra_failed`を分離する。
- Replay前にsubmission status、completion guard、attempt、keyを再検証する。
- Replay / purge API・UIは未実装である。

## Queue transport observability

### Event contract

`packages/queue/src/queue-event-logger.mjs` がevent nameとfield allowlistを正本とする。

Consumer event:

- `queue.delivery.accepted`
- `queue.delivery.rejected`
- `queue.consumer.poll_failed`
- `queue.consumer.processing_failed`
- `queue.visibility.extended`
- `queue.visibility.extension_failed`
- `queue.ack.succeeded`
- `queue.ack.deferred`
- `queue.ack.failed`

許可context例:

- Transport / provider / source / outcome / reason
- MessageId / delivery count
- Submission ID / grading attempt
- Correlation ID / schema version
- Generalized error type

禁止field:

- 提出コード本文
- Visible / hidden tests詳細
- Secret / token / password
- AWS credentials / credential source
- Attempt idempotency key
- QueueUrl
- ReceiptHandle
- Raw error message

Logger出力失敗はqueue処理・採点・recoveryへ例外を伝播しない。

## IAM・暗号化境界

### Runtime IAM

- Producerはsource queueへの`sqs:SendMessage`だけを基本権限とする。
- Consumerはsource queueへの`sqs:ReceiveMessage` / `sqs:DeleteMessage` / `sqs:ChangeMessageVisibility`だけを基本権限とする。
- Purge、queue作成・削除・属性変更、wildcard resource権限を付与しない。

### Encryption

- CloudFormation既定はSQS-managed SSEとする。
- Customer managed KMS key / key policyは別Issueとする。
- Customer managed KMS採用時はproducer / consumerのKMS権限とkey policyを同時にレビューする。

### Deployment IAM

- CloudFormation stackはIAM roleを作成するため`CAPABILITY_IAM`を必要とする。
- GitHub OIDC provider / deployment roleは未実装である。
- CIからAWS resourceを作成しない。

Policy例:

- `docs/security/iam/sqs-producer-policy.json`
- `docs/security/iam/sqs-producer-customer-managed-kms-policy.json`
- `docs/security/iam/sqs-consumer-policy.json`
- `docs/security/iam/sqs-consumer-customer-managed-kms-policy.json`

## Application retry・Worker回復

- Application retryはinfrastructure failure後にnew grading attempt / new keyを作成する。
- 現時点のretry producerはHTTP self-enqueueを維持する。
- Transport retryやdelivery countをgrading attemptとして扱わない。
- Worker起動時queued recoveryを維持する。
- Stale scannerは期限切れDB leaseをnew attemptへ回収する。
- External queue導入後もDB lease / stale scanner / attempt fencing / completion guardを維持する。

## データ管理

- Challenge: `challenges` + `challenge_versions`
- Submission: `submissions`
- Queue publish intent: `queue_outbox`
- 永続化: SQLite（`.data/app.db`）
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
- Hidden tests詳細はlearnerへ非公開とする。
- `/api/admin/*`はadminロール必須とする。
- Attempt key、lease、heartbeat、queue / outbox / DLQ / delivery countをlearnerへ返さない。
- Queue / DLQはprivate transportとservice-to-service認証を前提とする。
- QueueUrl、account ID、credential、ReceiptHandle、message bodyをRepositoryへ保存しない。

## 重要な不変条件

- API本体で提出コードを直接実行しない。
- Challenge編集はversion追加方式とし、既存versionを上書きしない。
- Submission終端結果はcompletion guardで一意化する。
- 旧attempt・期限切れleaseからの更新はattempt fencingで拒否する。
- Invalid / unconfirmed deliveryを削除しない。
- Outbox publish失敗時はpendingを維持する。
- HTTP producer / consumerを安全なrollback先として維持する。
- Runtime transport切替とresource deployを分離する。
- Retained queue削除はdepth、参照、保存要件、明示承認を確認して行う。

## 依存関係と制約

- 現行Runnerは簡易実行であり、将来は隔離強化が前提。
- 実AWS accountでのstack operation、SCP、quota、permission boundary、queue名衝突は未検証。
- ECS / Lambda / EC2 workloadとIAM roleの関連付けは未実装。
- VPC endpoint / network pathは未実装。
- Production transportはHTTPのままである。
- SQLite DB fileを複数ホストから共有する運用は前提にしない。
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ドキュメント正本は `docs/project-overview.md` のCanonical Source Rulesに従う。

## 詳細文書への導線

- 実装詳細: `docs/architecture.md`
- 要件定義: `docs/requirements.md`
- 現在状態: `docs/current-status.md`
- 進行中Issue: `docs/active-issues.md`
- Queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- SQS producer adapter: `docs/runbooks/2026-07-26-sqs-producer-adapter-poc-runbook.md`
- SQS runtime wiring: `docs/runbooks/2026-07-27-sqs-runtime-wiring-runbook.md`
- SQS consumer PoC: `docs/runbooks/2026-07-28-sqs-consumer-poc-runbook.md`
- SQS CloudFormation infrastructure: `docs/runbooks/2026-07-28-sqs-cloudformation-infra-runbook.md`
- Transactional outbox: `docs/runbooks/2026-07-25-transactional-outbox-runbook.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
