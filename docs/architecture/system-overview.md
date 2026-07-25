# system-overview（正本）

最終更新: 2026-07-25（Issue #117 transactional outbox PoCを反映）

## この文書の目的
実装詳細に入る前に、システム境界・責務分担・データフローを把握するためのアーキテクチャ概観を提供する。

## システム境界
- 学習者: Web UIから問題取得・提出・結果確認
- API: challenge/submission/adminの公開境界、認可制御、submission永続化、採点依頼
- Transactional outbox: submissionとqueue publish intentのatomic永続化、pending publish再送
- Queue contract / port: version付きmessage、producer / consumer共通validation、transport差し替え境界
- Queue transport: 現行HTTP通知、将来のdurable delivery / visibility / ack / retry / DLQ
- Queue observability: allowlist fieldのJSON Lines event、将来metrics / alertへ変換する監視契約
- Worker: 採点ジョブのclaim、実行、heartbeat、application retry backoff、stale scanner、結果保存、障害回復
- Runner: テスト実行と結果正規化

## 高レベル構成
1. WebがAPIからchallengeを取得する。
2. WebがAPIにsubmissionを作成する。
3. outbox無効時はAPIがsubmissionを保存後、queue producer portへ同期enqueueする。
4. outbox有効時はAPIがsubmissionとqueue publish intentを同一SQLite transactionで保存する。
5. outbox dispatcherがpending messageをqueue producer portへ渡す。
6. 現行HTTP adapterがWorker `POST /jobs`へmessageを通知する。
7. enqueue / outbox publish結果を構造化queue eventとして記録する。
8. Workerが共通message contractでrequestを検証し、delivery eventを記録する。
9. WorkerがDB上のsubmissionを条件付きclaimし、claim eventを記録する。
10. heartbeat有効時はWorkerがprocessing leaseを定期延長する。
11. WorkerがRunnerでvisible / hidden testsを実行する。
12. infrastructure failure時はretry上限を確認し、new attemptを作成する。
13. application retry backoff有効時はnew attemptのHTTP enqueue前にfull jitter delayを適用する。
14. stale recovery有効時はWorkerが起動時・定期的に期限切れleaseを走査する。
15. Workerがexpected attempt / keyによるfenced updateとcompletion guardで結果を保存する。
16. Webがsubmission結果をポーリング表示する。

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
- API legacy submission、outbox dispatcher、Worker retry、stale recoveryは同じ`enqueueSubmissionAttempt`経路を利用する。
- transport publishではgrading attempt / attempt idempotency keyを変更しない。
- API serviceは既存import互換性のため`enqueueSubmissionAttempt`をre-exportする。

### HTTP adapter
- 現行adapterはWorker `POST /jobs`へJSONを送る。
- HTTP 2xxを成功として扱う。
- 非2xx、network error、contract不正を失敗として扱う。
- Worker 202はprocess内受理であり、durable broker ackを意味しない。
- adapterはdelivery availabilityの境界であり、採点correctnessを保証しない。

## queue transport observability（Issue #113 / PR #114）

### event contract
- `packages/queue/src/queue-event-logger.mjs` がevent nameとfield allowlistを正本とする。
- 一つのeventを一つのJSON objectとしてstdout / stderrへ出力する。
- logger出力失敗はenqueue・採点・recovery・outbox処理へ例外を伝播しない。
- 未定義eventとallowlist外fieldは出力しない。
- string fieldは最大256文字へ制限する。

許可するcontext例:
- transport / source / outcome / reason
- submission ID / grading attempt / previous attempt / next attempt
- retry ordinal / delay / cap / backoff enabled
- optional correlation ID / schema version / HTTP status code
- trigger / scan件数 / publish・recovery集計
- generalized error type

禁止field:
- 提出コード本文
- visible / hidden tests詳細
- secret / token / password
- attempt idempotency key
- raw error message
- learnerへ不要なendpoint・認証情報

### event categories
- `queue.enqueue.*`: producerの成功、非2xx、network failure、contract rejection
- `queue.outbox.publish_*`: pending outboxのpublish成功・失敗
- `queue.outbox.dispatch_*`: batch dispatch結果・dispatcher障害
- `queue.delivery.*`: Worker `/jobs`のaccepted / rejected
- `queue.claim.*`: DB conditional claimのsuccess / no-op
- `queue.heartbeat.failed`: heartbeat更新失敗
- `queue.retry.*`: retry pending、新attempt開始、delay、再投入、終端化
- `queue.queued_recovery.*`: Worker起動時queued回収
- `queue.stale_recovery.*`: candidate回収、再投入失敗、scan summary

### metric変換候補
- `queue_enqueue_total{outcome,source}`
- `queue_outbox_publish_total{outcome,reason}`
- `queue_outbox_pending_count`
- `queue_outbox_oldest_pending_age_seconds`
- `queue_delivery_total{outcome,reason}`
- `queue_claim_total{outcome,reason}`
- `queue_retry_total{event,outcome,reason}`
- `queue_retry_delay_ms`
- `queue_recovery_total{event,outcome,reason}`
- `queue_heartbeat_failure_total`

現時点ではmetrics endpoint、backend、dashboard、alert本番設定を追加しない。

## application retry backoff（Issue #115 / PR #116）

### 責務
- application retryはinfrastructure failure後にnew grading attempt / new attempt keyを作成する。
- backoffはnew attempt作成後からHTTP enqueueまでの待機だけを担う。
- transport retryやqueue delivery countには適用しない。
- grading attempt上限は既存 `WORKER_MAX_INFRA_RETRY_ATTEMPTS` を正本とする。

### 設定
- `WORKER_APPLICATION_RETRY_BACKOFF_ENABLED=1` で有効化する。
- `WORKER_APPLICATION_RETRY_BASE_DELAY_MS` の既定値は5000ms。
- `WORKER_APPLICATION_RETRY_MAX_DELAY_MS` の既定値は60000ms。
- base / maxは正の整数とし、maxはbase以上とする。
- feature flag無効時はdelay 0msで現行の即時enqueueを維持する。

### delay policy
- `retryOrdinal = nextAttempt - 2`
- `capDelayMs = min(maxDelayMs, baseDelayMs * 2^retryOrdinal)`
- `delayMs = floor(capDelayMs * random())`
- delay wait失敗時は一般化eventを記録し、即時enqueueへフォールバックする。

### correctness境界
- new attempt / new keyはdelay前にDBへ確定する。
- delay中のsubmission statusは`queued`とする。
- 別Workerやstartup queued recoveryが先にclaimした場合、後続deliveryはattempt fencing / conditional claimでno-opになる。
- process内delayはbest-effortであり、durable delayed deliveryではない。

## transactional outbox PoC（Issue #117 / PR #118）

### 目的
- submission保存成功とqueue publish intent登録成功を一つのtransaction境界にする。
- DB保存後のAPI停止・HTTP enqueue失敗でpublish intentが失われるdual-write問題を解消する。
- 将来のexternal queue adapter導入前にproducer portと永続化責務を分離する。

### schema
`queue_outbox`は次を保持する。

- `id`
- `submission_id`
- `grading_attempt`
- `message_json`
- `status`（`pending` / `published`）
- `created_at` / `updated_at`
- `published_at`
- `publish_attempts`
- `last_attempted_at`
- `last_error_type`

制約:
- `(submission_id, grading_attempt)`を一意にする。
- pending検索用に`(status, created_at)` indexを使用する。
- `message_json`はqueue message contractだけを保持し、提出コードやtestsを含めない。

### atomic creation
- outbox有効時はSQLite `BEGIN IMMEDIATE` transactionを開始する。
- submission rowを`queued`で作成する。
- 同じattemptのqueue messageをoutboxへ`pending`で作成する。
- 両方の作成成功後にcommitする。
- outbox insertを含む途中失敗時はrollbackし、submissionだけを残さない。

### 設定
- `API_QUEUE_OUTBOX_ENABLED=1`でoutbox経路を有効化する。
- `API_QUEUE_OUTBOX_POLL_INTERVAL_MS`の既定値は1000ms。
- `API_QUEUE_OUTBOX_BATCH_SIZE`の既定値は25。
- interval / batch sizeは正のsafe integerとする。
- feature flag無効時はlegacyの保存→同期HTTP enqueueと502挙動を維持する。

### dispatcher
- API起動時、submission作成直後、設定intervalでpending rowを取得する。
- batch内の各messageを既存`enqueueSubmissionAttempt`へ渡す。
- enqueue成功時だけoutboxをpublishedへ更新する。
- enqueue失敗時はpendingを維持し、publish attempt、最終試行日時、一般化error typeを更新する。
- message parseやDB更新失敗をraw errorとして出力しない。
- 同一process内の重複dispatcher実行はskipする。

### API semantics
- outbox無効時のenqueue失敗は従来どおり502とする。
- outbox有効時はatomic保存成功をAPI受理条件とし、publish失敗でも201を返す。
- outbox状態、publish attempt、内部error typeをlearner responseへ返さない。

### delivery / correctness境界
- outboxはpublish intentのdurabilityを担う。
- outboxのpublishedは現行HTTP producerが2xxを受けたことを示し、durable broker保存を意味しない。
- 複数dispatcherや状態更新失敗によりduplicate publishが発生し得る。
- exactly-once publishへ正しさを依存しない。
- Worker conditional claim、attempt fencing、processing lease、completion guardが採点correctnessを担う。
- published更新失敗時はrowをpendingのまま残し、次回publishを許容する。

### PoC制約
- 実broker adapterは未導入。
- outbox claim / leaseは未実装で、複数API process間のduplicate publishを許容する。
- DLQ / replay / purge / retentionは未実装。
- pending件数・oldest ageのmetrics backendは未実装。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## 現行queue transport

### API producer
- outbox無効時はsubmission保存後にHTTP adapterへ同期通知する。
- outbox有効時はdispatcherがpending messageをHTTP adapterへ通知する。
- HTTP通知失敗時もsubmissionは`queued`、outboxは`pending`で残る。
- Worker起動時queued recoveryはoutboxとは独立したavailability safety netとして維持する。

### Worker consumer
- `POST /jobs`は共通message contractによるvalidation後に202を返し、process内で採点処理を開始する。
- duplicate notificationはDB conditional claimで一件だけ処理する。
- invalid JSON / invalid contractは400で拒否する。

### 現行制約
- durable broker message storageなし
- broker ack / nackなし
- queue visibility timeoutなし
- delivery countなし
- transport delayed delivery / transport backoffなし
- application retry delayはprocess内best-effortのみ
- DLQ / replay / purge / retentionなし
- metrics backend / dashboard / 本番alert設定なし

## queue運用方針（Issue #109 / PR #110）

### delivery semantics
- 将来queueはat-least-once deliveryを前提とする。
- exactly-once deliveryへ正しさを依存しない。
- duplicate deliveryは正常な障害モードとして扱う。
- WorkerはDB conditional claimに成功した場合のみ採点する。

### ack
- message受信直後にackしない。
- terminal結果、new attempt作成と再enqueue、retry enqueue failure終端化、安全なduplicate no-opのいずれかをDBで確認・保存した後にackする。
- ack前のconsumer停止はredeliveryで復旧する。

### visibility timeoutとDB lease
- queue visibility timeoutはdelivery availabilityを担う。
- DB processing leaseはcurrent attemptの実行所有権とcorrectnessを担う。
- attempt idempotency keyはattempt単位のfencingを担う。
- completion guardはsubmission終端保存の一意化を担う。
- external queue導入後もDB processing lease / attempt fencing / completion guardを維持する。

### retry
- transport retryは同一message / 同一attemptの再配送であり、grading attemptを増やさない。
- application retryは`retry_pending -> queued`でnew grading attempt / new keyを発行する。
- transport retryとapplication retryのbackoff設定を分離する。
- queue delivery countをgrading attemptとして扱わない。

### DLQ
- DLQはqueue messageの配送異常を隔離するinternal queueである。
- DLQとsubmission statusの`infra_failed`を分離する。
- runtime failure、通常test failure、terminal済みduplicate、old attempt messageをDLQへ入れない。
- replay前にDB status / completion guard / attempt / keyを再検証する。
- learnerはqueue / outbox / DLQ情報へアクセスできない。

### external queue migration
- queue contract / portは現行HTTP behaviorを維持して導入済み。
- queue transport observabilityはJSON Lines event contractとして導入済み。
- application retry backoffはprocess内best-effort seamとして導入済み。
- transactional outbox PoCは現行HTTP producerをpublish先として導入する。
- 次段階でoutbox dispatcher配下へ実broker producer adapterを追加する。
- rollout中はHTTP adapter、DB lease、queued recovery、stale scannerをrollback・safety netとして維持する。

## 採点ジョブ回復

### queued回収
- Worker起動時にDB上の`queued` submissionを回収する。
- `queued -> running`はsubmission ID / grading attempt / attempt idempotency key / completion guard条件付きclaimで一件だけ成功させる。

### processing lease / heartbeat
- heartbeat feature flag有効時のclaimでprocessing leaseを開始する。
- Workerは実行中にheartbeatを更新し、lease期限を延長する。
- heartbeat・非終端更新・terminal保存はexpected attempt / attempt idempotency key / lease期限でfenceする。
- lease期限切れ後の更新はno-opとする。
- completion guardはsubmission単位の終端一意化として維持する。

### stale running自動回収
- 候補は`running` / completion guard未設定 / lease非NULL / lease期限切れに限定する。
- leaseがNULLの`legacy_running`は自動回収しない。
- recoveryはSQLite `BEGIN IMMEDIATE` transaction内で行う。
- retry上限未満では`running -> retry_pending -> queued(new attempt/key)`を一貫処理する。
- retry上限到達時はcompletion guardを設定して`infra_failed`へ終端化する。
- stale recovery enqueueは現時点でapplication retry backoffとoutboxの対象外とし、既存挙動を維持する。

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
- attempt key、lease、heartbeat、worker識別情報、queue / outbox / DLQ情報はlearnerへ返さない。
- queue message / event / logsへ提出コード本文・hidden tests実データ・secret・raw error messageを記録しない。
- queue / outbox / DLQはprivate transportとservice-to-service認証を前提とする。

## 重要な不変条件
- API本体で提出コードを直接実行しない。
- challenge編集はversion追加方式とし、既存versionを上書きしない。
- submissionの終端結果はcompletion guardで一意化する。
- 旧attempt・期限切れleaseからの更新はattempt fencingで拒否する。
- stale回収は同じattemptを再利用せず、必ずnew attemptとして扱う。
- queue productやoutboxのdeduplication機能だけに正しさを依存しない。
- observability失敗で採点・outbox処理を失敗させない。
- delay失敗でsubmissionを中間状態へ残さず、即時enqueueへフォールバックする。
- outbox insert失敗時はsubmissionもrollbackする。
- outbox publish失敗時はpendingを維持する。
- external queue導入後もDB lease / attempt fencing / completion guardを維持する。

## 依存関係と制約
- 現行Runnerは簡易実行であり、将来は隔離強化が前提。
- 現行queue transportは簡易HTTP連携であり、将来置換を想定する。
- process内backoffはWorker再起動を越えて保持されない。
- transactional outbox PoCのpublish先は現行HTTP adapterであり、broker durabilityは提供しない。
- SQLite DB fileを複数ホストから共有する運用は前提にしない。
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ドキュメント正本は `docs/project-overview.md` のCanonical Source Rulesに従う。

## 詳細文書への導線
- 実装詳細: `docs/architecture.md`
- 要件定義: `docs/requirements.md`
- 現在状態: `docs/current-status.md`
- 進行中Issue: `docs/active-issues.md`
- queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- queue observability: `docs/runbooks/2026-07-24-queue-transport-observability-runbook.md`
- application retry backoff: `docs/runbooks/2026-07-25-application-retry-backoff-runbook.md`
- transactional outbox: `docs/runbooks/2026-07-25-transactional-outbox-runbook.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
