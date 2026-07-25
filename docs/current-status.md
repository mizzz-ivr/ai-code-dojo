# current-status（正本）

最終更新: 2026-07-25（Issue #117 transactional outbox PoCをレビュー中）

## この文書の目的
「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ai-code-dojoは、AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- attempt単位idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Issue #111 / PR #112でqueue message contractとqueue producer port、Issue #113 / PR #114で構造化queue eventを実装済み。
- Issue #115 / PR #116でapplication retryのexponential backoff + full jitter seamを実装済み。
- Issue #117 / PR #118でsubmission作成とqueue publish intentを同一transactionへまとめるtransactional outbox PoCを実装中。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## 稼働中の運用基盤
- 採点系はAPI→Workerの非同期連携を維持し、APIで提出コードを直接実行しない。
- queue message schema version 1はsubmission ID / grading attempt / attempt idempotency key / optional correlation IDだけを許可する。
- 現行publish先は共通queue producer port配下のHTTP adapterであり、Worker `POST /jobs`へ通知する。
- outbox無効時は従来どおりsubmission保存後に同期HTTP enqueueし、失敗時は502を返す。
- outbox有効時はsubmissionと`queue_outbox` rowを同一SQLite transactionで保存し、atomic保存成功後はpublish成否にかかわらず201で受理する。
- outbox dispatcherはAPI起動時・submission直後・設定intervalでpending rowをpublishする。
- publish成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。
- duplicate publishはat-least-once deliveryの正常な障害モードとして許容し、Worker conditional claim / attempt fencing / completion guardで二重採点を防止する。
- Workerは起動時にDB上の`queued` submissionを回収する。
- heartbeat有効時はprocessing leaseを保存し、heartbeat・状態更新・terminal保存をattempt/key/lease期限でfenceする。
- stale recovery有効時はlease期限切れrunningだけをnew attempt / new keyへ回収する。
- queue observabilityはallowlist fieldだけをJSON Linesへ出力し、code / tests / secret / attempt key / raw error messageを記録しない。
- learner-safe / internal境界を維持し、hidden tests詳細、attempt key、lease、heartbeat、outbox、queue内部情報は学習者へ返さない。
- CIはlint / typecheck / unit / integration / schema validation / build / docs validationを品質ゲートとする。

## 進行中事項
- Issue #117: `queue_outbox` tableとpending検索indexを追加する。
- Issue #117: submission + outboxを`BEGIN IMMEDIATE` transactionでatomic作成する。
- Issue #117: `API_QUEUE_OUTBOX_ENABLED`とpoll interval / batch size設定を追加する。
- Issue #117: pending outboxを既存queue producer portへpublishするdispatcherを追加する。
- Issue #117: publish成功時だけpublishedへ更新し、失敗時はpendingと一般化error typeを保持する。
- Issue #117: outbox publish / dispatchの構造化eventを追加する。
- Issue #117: unit / integration / migration testとRepository運用docsを整備する。

## 直近完了事項
- Issue #115 / PR #116を完了し、application retryのexponential backoff + full jitter、feature flag、運用runbook、安定したintegration runnerを実装した。
- Issue #113 / PR #114を完了し、queue transportの構造化イベントログ、field allowlist、metric / alert候補、運用runbookを実装した。
- Issue #111 / PR #112を完了し、version付きmessage contract、queue producer port、HTTP adapter、producer / consumer共通validationを実装した。
- Issue #109 / PR #110を完了し、at-least-once delivery、ack、visibility timeout、transport/application retry、DLQ、transactional outbox方針を確定した。

## 優先順位（直近）
1. Issue #117 / PR #118: transactional outbox PoCを実装する。
2. 後続P2: 実broker adapter / external queue PoCを追加する。
3. 後続P2: DLQ ops / replay / purgeを整備する。
4. 後続P2: queue eventをmetrics backend / dashboard / alertへ接続する。
5. 後続P2: durable application retry schedulingを設計する。
6. 継続: Runner隔離強化とhidden tests漏洩防止を改善する。

## branch cleanup 状態
- PR #116は2026-07-25にmerge済み。
- PR #116のhead branch `feat/application-retry-backoff` は削除確認対象。
- Issue #117の作業branchは `feat/transactional-outbox-poc`。
- PR #118 merge後にhead branchを削除する。

## 参照先
- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #117: `https://github.com/mizzz-ivr/ai-code-dojo/issues/117`
- PR #118: `https://github.com/mizzz-ivr/ai-code-dojo/pull/118`
- Issue #115: `https://github.com/mizzz-ivr/ai-code-dojo/issues/115`
- PR #116: `https://github.com/mizzz-ivr/ai-code-dojo/pull/116`
- queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- transactional outbox runbook: `docs/runbooks/2026-07-25-transactional-outbox-runbook.md`
- application retry backoff: `docs/runbooks/2026-07-25-application-retry-backoff-runbook.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
