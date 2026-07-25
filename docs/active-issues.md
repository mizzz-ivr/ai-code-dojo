# active-issues（正本）

最終更新: 2026-07-25（Issue #115 application retry backoffを実装中）

## この文書の目的
進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義
- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #115 application retryへexponential backoffとfull jitterの遅延ポリシーを追加する
- 優先度: P1
- 状態: Open / In Progress
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/115`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/116`（Draft）
- 作業branch: `feat/application-retry-backoff`
- 目的: infrastructure failure後のapplication retry再投入を設定可能なexponential backoff + full jitterで分散し、retry stormを抑制する。
- 対象:
  - `WORKER_APPLICATION_RETRY_BACKOFF_ENABLED`
  - base delay / max delay設定とvalidation
  - retry ordinalに基づくexponential cap
  - full jitter
  - injectable random / sleep
  - new attempt作成後・HTTP enqueue前のbest-effort delay
  - delay scheduled / failed構造化event
  - unit / integration test
  - current-status / active-issues / system-overview / runbook / logs / ai-prompts / handoff
- 非対象:
  - transport retry backoff
  - durable delayed delivery / DB `next_retry_at`
  - external queue / transactional outbox
  - visibility timeout / ack / nack / DLQ実装
  - metrics backend / dashboard / 本番alert設定
  - DB schema / migration / seed変更
  - Runner / hidden tests / auth / admin / UI / deployment変更
- 完了条件:
  - feature flag無効時は0msで現行即時enqueueを維持する。
  - retry回数に応じたexponential capとfull jitterを適用する。
  - delay wait失敗時は一般化eventを記録し、即時enqueueへフォールバックする。
  - attempt key、code、hidden tests、secret、raw error messageをeventへ出さない。
  - retry上限、processing lease、attempt fencing、completion guardを変更しない。
  - 全品質ゲートとdocs validationを通過する。

## Recently Completed

### #113 / PR #114 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`
- 関連資料:
  - `docs/runbooks/2026-07-24-queue-transport-observability-runbook.md`
  - `docs/logs/2026-07-24-issue-113-queue-transport-observability.md`
  - `docs/ai-prompts/2026-07-24-issue-113-queue-transport-observability-codex.md`
  - `docs/handoff/2026-07-24-issue-113-queue-transport-observability-handoff.md`
- 反映内容: enqueue / delivery / claim / heartbeat / retry / queued recovery / stale recoveryをallowlist fieldのJSON Lines eventとして実装し、metric・alert候補と運用runbookを整備した。

### #111 / PR #112 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-24
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/111`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/112`
- 関連資料:
  - `docs/logs/2026-07-24-issue-111-queue-contract-http-adapter.md`
  - `docs/ai-prompts/2026-07-24-issue-111-queue-contract-http-adapter-codex.md`
  - `docs/handoff/2026-07-24-issue-111-queue-contract-http-adapter-handoff.md`
- 反映内容: schema version 1のqueue message contract、producer port、HTTP adapter、producer / consumer共通validation、contract testを実装した。

### #109 / PR #110 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed（docs-only）
- 完了日: 2026-07-23
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/109`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/110`
- 成果物:
  - `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
  - `docs/adr/2026-07-23-queue-delivery-and-db-fencing-boundary.md`
- 反映内容: at-least-once delivery、ack、visibility timeout、transport/application retry、DLQ、transactional outbox、rollout / rollback方針を確定。

### #105 / PR #108 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-23
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/105`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/108`
- Linear mirror: `MIZ-34`（Done）
- 反映内容: lease期限切れrunningだけをexpected attempt / key / lease expiry付きtransactionでnew attemptへ回収し、startup / periodic scanner、retry上限判定、再投入失敗終端化を実装した。

### #106 / PR #107 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-23
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/106`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/107`
- 反映内容: retry再投入失敗時に現在のqueued attemptだけをattempt/keyでfenceし、completion guardを維持したまま `infra_failed` へ終端化する経路を追加した。

### #102 / PR #104 / #101 / PR #103 / #99 / PR #100 （完了済み）
- processing lease、heartbeat、attempt fencing、stale recovery設計、Worker起動時queued回収を段階的に整備済み。
- 詳細は各Issueのlogs / ai-prompts / handoffおよびreportsを参照する。

### #96 / PR #95 / #93 / #91 / #89 / #87 / #85 / #83 （完了済み）
- retry state machine、completion guard、SQLite migration順序、attempt単位idempotency key、重複採点防止設計を段階的に整備済み。
- 詳細は各Issueのlogs / ai-prompts / handoffおよびreportsを参照する。

## Next Issue Candidates

1. external queue / transactional outbox PoC Issue（P2）
   - 優先理由: 製品選定・dual-write対策・visibility / ack / DLQ contractを非本番で検証するため。
2. DLQ ops / replay / purge Issue（P2）
   - 優先理由: ops権限・監査・retentionを含む運用導線を整備するため。
3. queue metrics backend / dashboard / alert設定Issue（P2）
   - 優先理由: Issue #113のevent contractを実際の監視基盤へ接続するため。
4. durable application retry scheduling Issue（P2）
   - 優先理由: process内best-effort delayを外部queueまたは永続化時刻へ移行するため。

## Branch Cleanup

- PR #114のhead branch `feat/queue-transport-observability` は削除確認対象。
- Issue #115のhead branchは `feat/application-retry-backoff`。
- PR #116 merge後にIssue #115のhead branchを削除する。
