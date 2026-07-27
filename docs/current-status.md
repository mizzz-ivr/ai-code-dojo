# current-status（正本）

最終更新: 2026-07-28（Issue #123 SQS consumer PoCを実装中）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）

- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ai-code-dojoは、AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Queue message contract、producer port、構造化event、application retry backoff、transactional outboxまで実装済み。
- Issue #119 / PR #120でSQS producer adapter PoCを実装・merge済み。
- Issue #121 / PR #122でAWS SDK v3とAPI queue transport runtime wiringを実装・merge済み。
- Issue #123 / PR #124でWorker SQS consumer PoCを実装中。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## 実装済みのproducer基盤

- Queue message schema version 1はsubmission ID / grading attempt / attempt idempotency key / optional correlation IDだけを許可する。
- `API_QUEUE_TRANSPORT`の既定値は`http`であり、既存HTTP adapterをrollback先として維持する。
- SQS選択時は`API_QUEUE_OUTBOX_ENABLED=1`を必須とし、submissionとpublish intentを先にatomic保存する。
- SQS runtimeはAPI process内で一つの`SQSClient`を生成し、legacy enqueueとoutbox dispatcherで共有する。
- AWS credentialsはAWS SDK v3のdefault credential provider chainへ委譲する。
- SQS send成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。
- Duplicate publish / deliveryを許容し、Worker DB fencingで二重採点を防止する。

## Issue #123 / PR #124の変更

- `WORKER_QUEUE_CONSUMER=http|sqs`を追加し、既定値を`http`とする。
- HTTP選択時はAWS clientを生成しない。
- SQS選択時にregion、absolute HTTPS QueueUrl、long polling、visibility timeout、visibility heartbeatを検証する。
- Worker process単位で一つのSQS clientを生成・再利用する。
- `ReceiveMessage`は一件ずつlong pollingし、`ApproximateReceiveCount`を取得する。
- SQS envelopeとBodyを共通queue message parserで検証する。
- 処理中は`ChangeMessageVisibility`をbest-effortで実行する。
- DB terminal保存、retry処理完了、安全なno-op確認後だけ最新ReceiptHandleで`DeleteMessage`する。
- Invalid message、unexpected error、DB ownership喪失、保存未確認ではackを保留する。
- HTTP `POST /jobs`、queued recovery、stale scannerをrollback / safety netとして維持する。
- Consumer eventへMessageId / delivery countを追加し、ReceiptHandleはallowlistへ追加しない。
- Consumer最小IAM policy例とDLQ RedrivePolicy運用runbookを追加する。

## Correctness・セキュリティ境界

- Queue visibility timeoutはdelivery availabilityを担う。
- DB processing leaseはcurrent attemptの実行所有権を担う。
- Attempt idempotency keyとcompletion guardが採点correctnessを担う。
- Visibility延長失敗だけではDB結果保存を抑止しない。
- DB ownership喪失時は結果保存とackを抑止する。
- Exactly-once deliveryへ依存しない。
- Transport retryでgrading attempt / attempt keyを変更しない。
- Queue message / eventへcode / tests / secret / credentials / QueueUrl / ReceiptHandle / raw attempt key / raw SDK errorを記録しない。
- Learnerへqueue / outbox / DLQ / delivery count / internal errorを返さない。
- DLQとsubmission `infra_failed`を分離する。

## Test状況

- Config / consumer / runtime unit testを追加済み。
- Long polling→message validation→safe no-op→DeleteMessageのcomponent integrationを追加済み。
- Invalid contractを非削除とし、機微情報をeventへ出さないことを確認済み。
- 不正SQS設定でWorkerがlisten前に終了するstartup testを追加済み。
- 初回CIでは新規consumer testは成功したが、既存stale recovery integrationで一時SQLite lockが発生した。
- 無関係な修正を混在させず、final headで全品質ゲートを再確認する。

## 現時点の非対応・運用制約

- 実AWS source queue / DLQ / RedrivePolicy / IAM role / KMS key / VPC endpointは作成しない。
- Production deploymentはHTTP producer / consumerのまま。
- DLQ replay / purge API・UIは未実装。
- Worker application retry producerはHTTP self-enqueueを維持する。
- Queue / outbox metrics backend、dashboard、alertは未実装。
- Outbox claim / leaseは未実装で、複数API process間のduplicate publishを許容する。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## 優先順位（直近）

1. Issue #123 / PR #124を全品質ゲート成功・Ready for reviewへ進める。
2. SQS source queue / DLQ / RedrivePolicy / IAM role / deployment IaCを別Issueで整備する。
3. Worker application retry producerを選択queue runtimeへ統合する。
4. DLQ replay / purge運用を整備する。
5. Outbox claim / leaseを追加する。
6. Queue / outbox eventをmetrics backend / dashboard / alertへ接続する。
7. Runner隔離強化とhidden tests漏洩防止を継続する。

## branch cleanup 状態

- PR #122は2026-07-28（日本時間）にmerge済み。
- PR #122のhead branch `feat/sqs-runtime-wiring` は削除確認対象。
- Issue #123の作業branchは `feat/sqs-consumer-poc`。
- PR #124 merge後にhead branchを削除する。

## 参照先

- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #123: `https://github.com/mizzz-ivr/ai-code-dojo/issues/123`
- PR #124: `https://github.com/mizzz-ivr/ai-code-dojo/pull/124`
- SQS consumer runbook: `docs/runbooks/2026-07-28-sqs-consumer-poc-runbook.md`
- SQS runtime wiring: `docs/runbooks/2026-07-27-sqs-runtime-wiring-runbook.md`
- Queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
