# system-overview（正本）

最終更新: 2026-07-25（Issue #115 application retry backoffを反映）

## この文書の目的
実装詳細に入る前に、システム境界・責務分担・データフローを把握するためのアーキテクチャ概観を提供する。

## システム境界
- 学習者: Web UIから問題取得・提出・結果確認
- API: challenge/submission/adminの公開境界、認可制御、submission永続化、採点依頼
- Queue contract / port: version付きmessage、producer / consumer共通validation、transport差し替え境界
- Queue transport: 現行HTTP通知、将来のdurable delivery / visibility / ack / retry / DLQ
- Queue observability: allowlist fieldのJSON Lines event、将来metrics / alertへ変換する監視契約
- Worker: 採点ジョブのclaim、実行、heartbeat、application retry backoff、stale scanner、結果保存、障害回復
- Runner: テスト実行と結果正規化

## 高レベル構成
1. WebがAPIからchallengeを取得する。
2. WebがAPIにsubmissionを作成する。
3. APIがsubmissionをDBへ保存する。
4. APIがqueue messageを生成し、queue producer portへ渡す。
5. 現行HTTP adapterがWorker `POST /jobs`へmessageを通知する。
6. enqueue結果を構造化queue eventとして記録する。
7. Workerが共通message contractでrequestを検証し、delivery eventを記録する。
8. WorkerがDB上のsubmissionを条件付きclaimし、claim eventを記録する。
9. heartbeat有効時はWorkerがprocessing leaseを定期延長する。
10. WorkerがRunnerでvisible/hidden testsを実行する。
11. infrastructure failure時はretry上限を確認し、new attemptを作成する。
12. application retry backoff有効時はnew attemptのHTTP enqueue前にfull jitter delayを適用する。
13. stale recovery有効時はWorkerが起動時・定期的に期限切れleaseを走査する。
14. Workerがexpected attempt/keyによるfenced updateとcompletion guardで結果を保存する。
15. Webがsubmission結果をポーリング表示する。

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
- API submission作成後、Worker retry、stale recoveryは同じ`enqueueSubmissionAttempt`経路を利用する。
- transport retryではgrading attempt / attempt idempotency keyを変更しない。
- API serviceは既存import互換性のため`enqueueSubmissionAttempt`をre-exportする。

### HTTP adapter
- 現行adapterはWorker `POST /jobs`へJSONを送る。
- HTTP 2xxを成功として扱う。
- 非2xx、network error、contract不正を失敗として扱う。
- Worker 202はprocess内受理であり、durable queue保存・broker ackを意味しない。
- adapterはdelivery availabilityの境界であり、採点correctnessを保証しない。

## queue transport observability（Issue #113 / PR #114）

### event contract
- `packages/queue/src/queue-event-logger.mjs` がevent nameとfield allowlistを正本とする。
- 一つのeventを一つのJSON objectとしてstdout / stderrへ出力する。
- logger出力失敗はenqueue・採点・recovery処理へ例外を伝播しない。
- 未定義eventは出力しない。
- allowlist外fieldは出力しない。
- string fieldはログ肥大化を防ぐため最大256文字へ制限する。

共通field:
- `timestamp`
- `level`
- `service`
- `event`

許可するcontext例:
- transport / source / outcome / reason
- submission id / grading attempt / previous attempt / next attempt
- retry ordinal / delay / cap / backoff enabled
- optional correlation id / schema version / HTTP status code
- trigger / scan件数 / recovery集計
- generalized error type

禁止field:
- 提出コード本文
- visible / hidden tests詳細
- secret / token / password
- attempt idempotency key
- raw error message
- learnerへ不要なendpoint・認証情報

### event categories
- `queue.enqueue.*`: HTTP producerの成功、非2xx、network failure、contract rejection
- `queue.delivery.*`: Worker `/jobs`のaccepted / rejected
- `queue.claim.*`: DB conditional claimのsuccess / no-op
- `queue.heartbeat.failed`: heartbeat更新失敗
- `queue.retry.*`: retry pending、新attempt開始、delay、再投入、終端化
- `queue.queued_recovery.*`: Worker起動時queued回収
- `queue.stale_recovery.*`: candidate回収、再投入失敗、scan summary

### metric変換候補
外部metrics backend導入時はevent集計から次を生成する。

- `queue_enqueue_total{outcome,source}`
- `queue_delivery_total{outcome,reason}`
- `queue_claim_total{outcome,reason}`
- `queue_retry_total{event,outcome,reason}`
- `queue_retry_delay_ms`
- `queue_recovery_total{event,outcome,reason}`
- `queue_heartbeat_failure_total`
- `queue_stale_scan_candidates_total`
- `queue_stale_scan_errors_total`

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
- `retryOrdinal = nextAttempt - 2` とする。
- `capDelayMs = min(maxDelayMs, baseDelayMs * 2^retryOrdinal)` とする。
- `delayMs = floor(capDelayMs * random())` のfull jitterを使用する。
- random / sleepを注入可能にし、実時間待機なしでunit testする。
- delay waitが失敗した場合は一般化eventを記録し、即時enqueueへフォールバックする。

### correctness境界
- new attempt / new keyはdelay前にDBへ確定する。
- delay中のsubmission statusは `queued` とする。
- 別WorkerやWorker再起動時queued回収が先にclaimした場合、後続HTTP deliveryは既存のattempt fencing / conditional claimでno-opになる。
- process内delayはbest-effortであり、durable delayed deliveryではない。
- Worker再起動時queued回収はavailability safety netとしてdelayを短絡し得る。
- durableな再試行時刻が必要な場合はexternal queue delayed deliveryまたは永続化された`next_retry_at`を別Issueで設計する。

### observability
- `queue.retry.delay_scheduled` にretry ordinal / delay / cap / enabled状態を記録する。
- `queue.retry.delay_failed` に一般化reason / error typeを記録する。
- attempt key、code、hidden tests、secret、raw error messageを記録しない。

## 現行queue transport

### API producer
- APIはsubmissionを `queued` で保存後、共通queue producer portへmessageを渡す。
- 現行HTTP adapterがWorker `POST /jobs`へ同期HTTPで通知する。
- 通知失敗時もDBのqueued行は残り、Worker起動時queued回収が復旧経路となる。

### Worker consumer
- `POST /jobs`は共通message contractによるvalidation後に202を返し、process内で採点処理を開始する。
- duplicate notificationはDB conditional claimで一件だけ処理する。
- invalid JSON / invalid contractは400で拒否する。

### 現行制約
- durable message storageなし
- ack / nackなし
- queue visibility timeoutなし
- delivery countなし
- transport delayed delivery / transport backoffなし
- application retry delayはprocess内best-effortのみ
- DLQ / replay / purge / retentionなし
- queue depth / oldest message ageなし
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
- 外部queue導入後もDB processing lease / attempt fencing / completion guardを維持する。

### retry
- transport retryは同一message / 同一attemptの再配送であり、grading attemptを増やさない。
- application retryは `retry_pending -> queued` でnew grading attempt / new keyを発行する。
- transport retryとapplication retryのbackoff設定を分離する。
- queue delivery countをgrading attemptとして扱わない。

### DLQ
- DLQはqueue messageの配送異常を隔離するinternal queueである。
- DLQとsubmission statusの `infra_failed` を分離する。
- Runtime failure、通常test failure、terminal済みduplicate、old attempt messageをDLQへ入れない。
- replay前にDBのstatus / completion guard / attempt / keyを再検証する。
- learnerはqueue / DLQ情報へアクセスできない。

### external queue migration
- queue contract / portは現行HTTP behaviorを維持して導入済み。
- queue transport observabilityはJSON Lines event contractとして導入済み。
- application retry backoffはprocess内best-effort seamとして導入済み。
- external queue導入時はtransactional outboxを推奨する。
- rollout中はHTTP adapter、DB lease、stale scannerをrollback・safety netとして維持する。

詳細:
- `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- `docs/adr/2026-07-23-queue-delivery-and-db-fencing-boundary.md`

## 採点ジョブ回復

### queued回収
- Worker起動時にDB上の `queued` submissionを回収する。
- `queued -> running` はsubmission id / grading attempt / attempt idempotency key / completion guard条件付きclaimで一件だけ成功させる。

### processing lease / heartbeat
- heartbeat feature flag有効時のclaimでprocessing leaseを開始する。
- Workerは実行中にheartbeatを更新し、lease期限を延長する。
- heartbeat・非終端更新・terminal保存はexpected attempt / attempt idempotency key / lease期限でfenceする。
- lease期限切れ後のheartbeat・状態更新・terminal保存はno-opとする。
- completion guardはsubmission単位の終端一意化として維持する。

### stale running自動回収
- 候補は `status = running` / completion guard未設定 / lease非NULL / lease期限切れに限定する。
- leaseがNULLの `legacy_running` は自動回収しない。
- recoveryはSQLiteの `BEGIN IMMEDIATE` transaction内で行う。
- retry上限未満では `running -> retry_pending -> queued(new attempt/key)` を一貫処理する。
- retry上限到達時はcompletion guardを設定して `infra_failed` へ終端化する。
- 回収成功したnew attemptだけを共通queue producer portへ再投入する。
- stale recovery再投入は現時点でapplication retry backoffの対象外とし、既存挙動を維持する。
- 回収後の再投入失敗はqueued attempt専用fenced経路で `infra_failed` へ確定する。

## データ管理
- challenge本体: `challenges` + `challenge_versions`
- submission: `submissions`
- 永続化: SQLite（`.data/app.db`）
- submission内部制御:
  - `grading_attempt`
  - `attempt_idempotency_key`
  - `completion_guard_at`
  - `processing_claimed_at`
  - `processing_heartbeat_at`
  - `processing_lease_expires_at`
- Issue #115ではDB schema / migrationを変更しない。
- external queue導入時のdual-write対策としてtransactional outboxを別Issueで検討する。

## セキュリティ境界
- learner-safeとinternalレスポンスを分離する。
- hidden tests詳細はlearnerへ非公開とする。
- `/api/admin/*` はadminロール必須とする。
- attempt key、lease、heartbeat、worker識別情報、queue / DLQ情報はlearnerへ返さない。
- queue message / event / logsへ提出コード本文・hidden tests実データ・secret・raw error messageを記録しない。
- queue / DLQはprivate transportとservice-to-service認証を前提とする。

## 重要な不変条件
- API本体で提出コードを直接実行しない。
- challenge編集はversion追加方式とし、既存versionを上書きしない。
- submissionの終端結果はcompletion guardで一意化する。
- 旧attempt・期限切れleaseからの更新はattempt fencingで拒否する。
- stale回収は同じattemptを再利用せず、必ずnew attemptとして扱う。
- queue productのdeduplication機能だけに正しさを依存しない。
- observability失敗で採点処理を失敗させない。
- delay失敗でsubmissionを中間状態へ残さず、即時enqueueへフォールバックする。
- external queue導入後もDB lease / attempt fencing / completion guardを維持する。

## 依存関係と制約
- 現行Runnerは簡易実行であり、将来は隔離強化が前提。
- 現行queue transportは簡易HTTP連携であり、将来置換を想定する。
- process内backoffはWorker再起動を越えて保持されない。
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
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
