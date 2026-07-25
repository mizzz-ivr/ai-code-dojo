# current-status（正本）

最終更新: 2026-07-24（Issue #113 queue transport observabilityを実装中）

## この文書の目的
「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ai-code-dojoは、AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- attempt単位idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Issue #109 / PR #110で現行HTTP queueと将来外部queueのdelivery / ack / visibility / retry / DLQ責務を確定した。
- Issue #111 / PR #112でqueue message contract、queue producer port、HTTP adapterを現行挙動を維持したまま分離した。
- Issue #113 / PR #114でqueue enqueue / delivery / claim / retry / recoveryを機微情報なしの構造化イベントとして実装中。
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
- learner-safe / internal境界を維持し、hidden tests詳細、attempt key、lease、heartbeat、queue内部情報は学習者へ返さない。
- CIはlint / typecheck / unit / integration / schema validation / build / docs validationを品質ゲートとする。

## 進行中事項
- Issue #113: queue event nameと出力fieldをallowlistとして固定する。
- Issue #113: enqueue success / failure / contract rejectionをJSON Linesで記録する。
- Issue #113: Worker delivery accepted / rejected、claim success / no-opを記録する。
- Issue #113: heartbeat failure、application retry、queued startup recoveryを記録する。
- Issue #113: stale recovery candidate / scan結果を同じevent contractへ統一する。
- Issue #113: metric候補・alert候補・確認手順をrunbookへ反映する。
- Issue #113: unit / integration testとRepository運用docsを整備する。

## 直近完了事項
- Issue #111 / PR #112を完了し、version付きmessage contract、queue producer port、HTTP adapter、producer / consumer共通validationを実装した。
- Issue #109 / PR #110を完了し、at-least-once delivery、ack、visibility timeout、transport/application retry、DLQ、transactional outbox、rollout / rollback方針を確定した。
- Issue #105 / PR #108を完了し、lease期限切れrunningのstartup / periodic scannerと安全なnew attempt回収を実装した。
- Issue #106 / PR #107を完了し、retry再投入失敗時にqueued attemptが残る不具合を修正した。
- Issue #102 / PR #104を完了し、processing lease関連列、heartbeat、attempt fencingを実装した。

## 優先順位（直近）
1. Issue #113 / PR #114: queue transportの構造化イベントログと監視契約を実装する。
2. 後続P1: application retry backoff seamを実装する。
3. 後続P2: external queue / transactional outbox PoCを進める。
4. 後続P2: DLQ ops / replay / purgeを整備する。
5. 継続: Runner隔離強化とhidden tests漏洩防止を改善する。

## branch cleanup 状態
- PR #112は2026-07-24にmerge済み。
- PR #112のhead branch `refactor/queue-contract-http-adapter` はbranch検索で見つからず、削除済み相当。
- Issue #113の作業branchは `feat/queue-transport-observability`。
- PR #114 merge後にhead branchを削除する。

## 参照先
- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #113: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- PR #114: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`
- Issue #111: `https://github.com/mizzz-ivr/ai-code-dojo/issues/111`
- PR #112: `https://github.com/mizzz-ivr/ai-code-dojo/pull/112`
- queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- queue責務ADR: `docs/adr/2026-07-23-queue-delivery-and-db-fencing-boundary.md`
- Worker障害復旧runbook: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
