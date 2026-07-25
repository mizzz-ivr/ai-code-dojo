# current-status（正本）

最終更新: 2026-07-25（Issue #115 application retry backoffを実装中）

## この文書の目的
「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ai-code-dojoは、AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- attempt単位idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Issue #109 / PR #110で現行HTTP queueと将来外部queueのdelivery / ack / visibility / retry / DLQ責務を確定した。
- Issue #111 / PR #112でqueue message contract、queue producer port、HTTP adapterを分離した。
- Issue #113 / PR #114でqueue enqueue / delivery / claim / retry / recoveryを機微情報なしの構造化イベントとして実装した。
- Issue #115 / PR #116でapplication retryのexponential backoff + full jitter seamを実装中。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## 稼働中の運用基盤
- 採点系はAPI→Workerの非同期連携を維持し、APIで提出コードを直接実行しない。
- 現行enqueueは共通queue producer portからHTTP adapterを経由してWorker `POST /jobs`へ通知する。
- queue message schema version 1はsubmission ID / grading attempt / attempt idempotency key / optional correlation IDだけを許可する。
- Workerは起動時にDB上の `queued` submissionを回収する。
- `queued -> running` はattempt / idempotency key / completion guard条件付きclaimで一件だけ成功させる。
- heartbeat有効時はprocessing leaseを保存し、heartbeat・状態更新・terminal保存をattempt/key/lease期限でfenceする。
- stale recovery有効時はlease期限切れrunningだけをnew attempt / new keyへ回収する。
- queue observabilityはallowlist fieldだけをJSON Linesへ出力し、code / tests / secret / attempt key / raw error messageを記録しない。
- application retry backoffはfeature flag無効時に0msで現行挙動を維持し、有効時だけnew attempt作成後のenqueueを遅延する。
- learner-safe / internal境界を維持し、hidden tests詳細、attempt key、lease、heartbeat、queue内部情報は学習者へ返さない。
- CIはlint / typecheck / unit / integration / schema validation / build / docs validationを品質ゲートとする。

## 進行中事項
- Issue #115: application retry backoff設定と起動時validationを追加する。
- Issue #115: retry ordinalに基づくexponential capとfull jitterを実装する。
- Issue #115: clock / sleep / randomを注入可能なdelay policyを実装する。
- Issue #115: new attempt作成後、HTTP enqueue前にbest-effort delayを適用する。
- Issue #115: delay scheduled / failedを既存queue event contractへ追加する。
- Issue #115: feature flag無効時の即時enqueueと既存fencingを回帰確認する。
- Issue #115: unit / integration testとRepository運用docsを整備する。

## 直近完了事項
- Issue #113 / PR #114を完了し、queue transportの構造化イベントログ、field allowlist、metric / alert候補、運用runbookを実装した。
- Issue #111 / PR #112を完了し、version付きmessage contract、queue producer port、HTTP adapter、producer / consumer共通validationを実装した。
- Issue #109 / PR #110を完了し、at-least-once delivery、ack、visibility timeout、transport/application retry、DLQ、transactional outbox方針を確定した。
- Issue #105 / PR #108を完了し、lease期限切れrunningのstartup / periodic scannerと安全なnew attempt回収を実装した。
- Issue #106 / PR #107を完了し、retry再投入失敗時にqueued attemptが残る不具合を修正した。

## 優先順位（直近）
1. Issue #115 / PR #116: application retryへexponential backoff + full jitterを追加する。
2. 後続P2: external queue / transactional outbox PoCを進める。
3. 後続P2: DLQ ops / replay / purgeを整備する。
4. 後続P2: queue eventをmetrics backend / dashboard / alertへ接続する。
5. 継続: Runner隔離強化とhidden tests漏洩防止を改善する。

## branch cleanup 状態
- PR #114は2026-07-25にmerge済み。
- PR #114のhead branch `feat/queue-transport-observability` は削除確認対象。
- Issue #115の作業branchは `feat/application-retry-backoff`。
- PR #116 merge後にhead branchを削除する。

## 参照先
- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #115: `https://github.com/mizzz-ivr/ai-code-dojo/issues/115`
- PR #116: `https://github.com/mizzz-ivr/ai-code-dojo/pull/116`
- Issue #113: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- PR #114: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`
- queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- queue observability runbook: `docs/runbooks/2026-07-24-queue-transport-observability-runbook.md`
- Worker障害復旧runbook: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
