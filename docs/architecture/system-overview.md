# system-overview（正本）

最終更新: 2026-07-27（Issue #121 SQS runtime wiringを反映）

## この文書の目的
実装詳細に入る前に、システム境界・責務分担・データフローを把握するためのアーキテクチャ概観を提供する。

## システム境界
- 学習者: Web UIから問題取得・提出・結果確認
- API: challenge/submission/adminの公開境界、認可制御、submission永続化、採点依頼
- Transactional outbox: submissionとqueue publish intentのatomic永続化、pending publish再送
- Queue contract / port: version付きmessage、producer / consumer共通validation、transport差し替え境界
- Queue runtime: API起動時のHTTP / SQS選択、producer lifecycle、legacy / outbox共通enqueue
- Queue transport: HTTP通知、SQS SendMessage、将来のReceiveMessage / visibility / ack / DLQ
- Queue observability: allowlist fieldのJSON Lines event、将来metrics / alertへ変換する監視契約
- Worker: 採点ジョブのclaim、実行、heartbeat、application retry、stale scanner、結果保存、障害回復
- Runner: テスト実行と結果正規化

## 高レベル構成
1. WebがAPIからchallengeを取得する。
2. WebがAPIにsubmissionを作成する。
3. outbox無効時はAPIがsubmissionを保存後、queue runtimeへ同期enqueueする。
4. outbox有効時はAPIがsubmissionとqueue publish intentを同一SQLite transactionで保存する。
5. outbox dispatcherがpending messageを同じqueue runtimeへ渡す。
6. `API_QUEUE_TRANSPORT=http`ではHTTP adapterがWorker `POST /jobs`へmessageを通知する。
7. `API_QUEUE_TRANSPORT=sqs`ではSQS adapterがAWS SDK v3の`SendMessageCommand`を送信する。
8. enqueue / outbox publish結果を構造化queue eventとして記録する。
9. HTTP経路ではWorkerが共通message contractでrequestを検証し、DB上のsubmissionを条件付きclaimする。
10. heartbeat有効時はWorkerがprocessing leaseを定期延長する。
11. WorkerがRunnerでvisible / hidden testsを実行する。
12. infrastructure failure時はretry上限を確認し、new attemptを作成する。
13. stale recovery有効時はWorkerが期限切れleaseを走査する。
14. Workerがexpected attempt / keyによるfenced updateとcompletion guardで結果を保存する。
15. Webがsubmission結果をポーリング表示する。

SQS consumerは未実装であるため、SQS transportを選択しただけではWorkerによる採点開始まで到達しない。実queueへのproduction切替はconsumer実装とdeployment検証後に行う。

## queue message contract（Issue #111 / PR #112）

### schema version 1
queue messageは次の参照情報だけを持つ。

- `schemaVersion = 1`
- `submissionId`
- `gradingAttempt`
- `attemptIdempotencyKey`
- optional `correlationId`

producer / consumerは `packages/queue/src/message-contract.mjs` の同一parserを利用する。

拒否対象:
- 未対応schema version
- 必須field欠落
- 不正型・空文字・0以下のattempt
- 未知field
- 不正JSON

messageへ次を含めない。
- 提出コード本文
- visible / hidden tests詳細
- challenge本文
- secret / token / password
- learnerへ不要な内部障害詳細

### queue producer port
- portは `enqueue(message) -> boolean` の最小interfaceとする。
- API legacy submissionとoutbox dispatcherはAPI起動時に生成した同じruntime enqueueを利用する。
- Worker retry / stale recoveryは既存producer contractを維持する。
- transport publishではgrading attempt / attempt idempotency keyを変更しない。

## queue runtime（Issue #121 / PR #122）

### transport選択
- `API_QUEUE_TRANSPORT`は`http`または`sqs`を許可する。
- 既定値は`http`とし、既存動作とrollback経路を維持する。
- HTTP選択時はSQS関連設定を参照せず、AWS clientを生成しない。
- SQS選択時は`API_QUEUE_OUTBOX_ENABLED=1`を必須とする。

### SQS設定
SQS選択時に次を起動時検証する。

- `API_SQS_REGION`: non-empty AWS region identifier
- `API_SQS_QUEUE_URL`: absolute HTTPS URL
- `API_SQS_QUEUE_TYPE`: `standard`または`fifo`
- QueueUrlにcredentials、query、fragmentを含めない
- FIFO指定時はqueue nameが`.fifo`で終わる
- Standard指定時は`.fifo` queueを拒否する

設定不正時はAPIを起動せず、誤ったtransportでsubmissionを受理しない。

### client lifecycle
- SQS選択時にAPI process単位で一つの`SQSClient`を生成する。
- clientはlegacy enqueueとoutbox dispatcherで再利用する。
- API終了時に`destroy()`をbest-effortで呼び出す。
- destroy失敗はshutdownへ例外を伝播しない。

### credentials
- application固有のaccess key / secret key設定を追加しない。
- credentialsはAWS SDK v3のdefault credential provider chainへ委譲する。
- IAM role、web identity、shared config等の具体的な供給方法はdeployment責務とする。
- credentials値、credential source、tokenをqueue message / event / learner responseへ出力しない。
- credentials不足は最初のSQS send時に失敗し、outbox rowをpendingのまま再試行対象として保持する。

### dependency
- `@aws-sdk/client-sqs`をroot dependencyとして固定する。
- `pnpm-lock.yaml`はRepository指定のpnpm versionで生成し、CIは`--frozen-lockfile`を維持する。

## queue adapters

### HTTP adapter
- Worker `POST /jobs`へversion付きJSONを送る。
- HTTP 2xxを成功として扱う。
- 非2xx、network error、contract不正を失敗として扱う。
- Worker 202はprocess内受理であり、durable broker ackを意味しない。
- HTTPを既定transportとrollback先として維持する。

### SQS producer adapter（Issue #119 / PR #120）
- `packages/queue/src/sqs-queue-producer.mjs` が`enqueue(message) -> boolean`を提供する。
- Standard queueでは`QueueUrl`とversion付き`MessageBody`を構築する。
- FIFO queueではsubmission単位の`MessageGroupId`とattempt単位の`MessageDeduplicationId`をSHA-256で導出する。
- FIFO metadataへraw submission IDやraw attempt keyを含めない。
- `client.send`成功後に非空の`MessageId`を取得した場合だけpublish成功とする。
- SDK例外、command生成失敗、MessageId欠落、contract不正はfalseへ正規化する。
- queue URL、credentials、raw error message、attempt keyをeventへ出力しない。

## transactional outbox（Issue #117 / PR #118）

### atomic creation
- outbox有効時はSQLite `BEGIN IMMEDIATE` transactionを開始する。
- submission rowを`queued`で作成する。
- 同じattemptのqueue messageを`queue_outbox`へ`pending`で作成する。
- 両方の作成成功後にcommitする。
- 途中失敗時はrollbackし、submissionだけを残さない。

### dispatcher
- API起動時、submission作成直後、設定intervalでpending rowを取得する。
- 選択されたqueue runtimeへmessageを渡す。
- enqueue成功時だけoutboxをpublishedへ更新する。
- enqueue失敗時はpendingを維持し、試行回数・最終試行日時・一般化error typeを更新する。
- 同一process内の重複dispatcher実行はskipする。
- transport名をeventへ注入し、HTTP / SQSを正しく分類する。

### API semantics
- outbox無効時のenqueue失敗は502とする。
- outbox有効時はatomic保存成功をAPI受理条件とし、publish失敗でも201を返す。
- outbox状態、publish attempt、内部error typeをlearner responseへ返さない。
- SQS transportはoutbox有効時だけ許可し、publish intent消失を避ける。

### correctness境界
- outboxはpublish intent durabilityを担う。
- queue transportはdelivery availabilityを担う。
- Worker conditional claim、attempt fencing、processing lease、completion guardが採点correctnessを担う。
- exactly-once publish / deliveryへ正しさを依存しない。
- published更新失敗時はrowをpendingのまま残し、duplicate publishを許容する。

## queue transport observability（Issue #113 / PR #114）

### event contract
- `packages/queue/src/queue-event-logger.mjs` がevent nameとfield allowlistを正本とする。
- 一つのeventを一つのJSON objectとしてstdout / stderrへ出力する。
- logger出力失敗はenqueue・採点・recovery・outbox処理へ例外を伝播しない。
- 未定義eventとallowlist外fieldは出力しない。
- string fieldは最大256文字へ制限する。

許可するcontext例:
- transport / provider / queue type / source / outcome / reason
- submission ID / grading attempt / previous attempt / next attempt
- retry ordinal / delay / cap / backoff enabled
- optional correlation ID / schema version / HTTP status code
- trigger / scan件数 / publish・recovery集計
- generalized error type

禁止field:
- 提出コード本文
- visible / hidden tests詳細
- secret / token / password
- AWS credentials / credential source
- attempt idempotency key
- QueueUrl
- raw error message

## IAM・暗号化境界
- Producer roleの基本権限は対象queue ARNへの`sqs:SendMessage`だけとする。
- `ReceiveMessage`、`DeleteMessage`、`PurgeQueue`、queue管理権限をproducer roleへ付与しない。
- customer managed KMS keyでqueueを暗号化する場合だけ、対象keyへの`kms:Decrypt`と`kms:GenerateDataKey`を追加する。
- IAM role、queue policy、KMS key policy、TLS強制、VPC endpointはdeployment / IaCの責務とする。
- policy例:
  - `docs/security/iam/sqs-producer-policy.json`
  - `docs/security/iam/sqs-producer-customer-managed-kms-policy.json`

## application retry backoff（Issue #115 / PR #116）
- application retryはinfrastructure failure後にnew grading attempt / new attempt keyを作成する。
- backoffはnew attempt作成後からenqueueまでの待機だけを担う。
- transport retryやqueue delivery countには適用しない。
- process内delayはbest-effortであり、Worker再起動を越えて保持されない。
- SQS delayed deliveryやdurable retry schedulingは未実装。

## Worker consumer・回復

### 現行HTTP consumer
- `POST /jobs`は共通message contractによるvalidation後に202を返す。
- duplicate notificationはDB conditional claimで一件だけ処理する。
- invalid JSON / invalid contractは400で拒否する。

### SQS consumer
- `ReceiveMessage` / long polling / visibility timeout / `DeleteMessage`は未実装。
- SQS producer runtimeを有効化しても、consumerがない環境ではmessageがqueueへ滞留する。
- consumer実装は別Issueとし、producer runtime wiringへ混在させない。

### processing lease / heartbeat
- Workerは実行中にprocessing leaseを定期延長する。
- heartbeat・非終端更新・terminal保存はexpected attempt / attempt key / lease期限でfenceする。
- lease期限切れ後の更新はno-opとする。

### stale running自動回収
- `running` / completion guard未設定 / lease非NULL / lease期限切れだけを候補とする。
- recoveryはSQLite transaction内でnew attempt / new keyを発行する。
- retry上限到達時はcompletion guardを設定して`infra_failed`へ終端化する。

## データ管理
- challenge本体: `challenges` + `challenge_versions`
- submission: `submissions`
- queue publish intent: `queue_outbox`
- 永続化: SQLite（`.data/app.db`）
- submission内部制御:
  - `grading_attempt`
  - `attempt_idempotency_key`
  - `completion_guard_at`
  - `processing_claimed_at`
  - `processing_heartbeat_at`
  - `processing_lease_expires_at`
- outbox内部制御:
  - `status`
  - `publish_attempts`
  - `last_attempted_at`
  - `last_error_type`
  - `published_at`

## セキュリティ境界
- learner-safeとinternalレスポンスを分離する。
- hidden tests詳細はlearnerへ非公開とする。
- `/api/admin/*`はadminロール必須とする。
- attempt key、lease、heartbeat、queue / outbox / DLQ情報はlearnerへ返さない。
- queue message / SQS metadata / event / logsへ提出コード本文・tests・secret・credentials・raw errorを記録しない。
- private transportとservice-to-service認証を前提とする。

## 重要な不変条件
- API本体で提出コードを直接実行しない。
- challenge編集はversion追加方式とし、既存versionを上書きしない。
- submissionの終端結果はcompletion guardで一意化する。
- 旧attempt・期限切れleaseからの更新はattempt fencingで拒否する。
- queue製品、SQS FIFO deduplication、outboxだけに採点correctnessを依存しない。
- outbox insert失敗時はsubmissionもrollbackする。
- outbox publish失敗時はpendingを維持する。
- external queue導入後もDB lease / attempt fencing / completion guardを維持する。
- HTTP transportを安全なrollback先として維持する。

## 依存関係と制約
- 現行Runnerは簡易実行であり、将来は隔離強化が前提。
- SQS producer runtimeは実装するが、実AWS resource・consumer・production deploymentは別責務。
- SQLite DB fileを複数ホストから共有する運用は前提にしない。
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ドキュメント正本は `docs/project-overview.md` のCanonical Source Rulesに従う。

## 詳細文書への導線
- 実装詳細: `docs/architecture.md`
- 要件定義: `docs/requirements.md`
- 現在状態: `docs/current-status.md`
- 進行中Issue: `docs/active-issues.md`
- queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- SQS producer adapter: `docs/runbooks/2026-07-26-sqs-producer-adapter-poc-runbook.md`
- SQS runtime wiring: `docs/runbooks/2026-07-27-sqs-runtime-wiring-runbook.md`
- transactional outbox: `docs/runbooks/2026-07-25-transactional-outbox-runbook.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
