# active-issues（正本）

最終更新: 2026-07-24（Issue #113 queue transport observabilityをレビュー中）

## この文書の目的
進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義
- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #113 queue transportの構造化イベントログと監視契約を実装する
- 優先度: P1
- 状態: Open / Review
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`（Ready for review）
- 作業branch: `feat/queue-transport-observability`
- 目的: 現行HTTP queueのenqueue / delivery / claim / retry / stale recoveryを、機微情報を含めない安定した構造化eventとして観測可能にする。
- 対象:
  - queue event name / field allowlist
  - stdout / stderr JSON Lines logger
  - enqueue success / failure / contract rejection
  - Worker delivery accepted / rejected
  - conditional claim success / no-op
  - heartbeat failure
  - application retry / queued startup recovery
  - stale recovery candidate / scan result
  - unit / integration test
  - metric候補 / alert候補 / runbook
  - current-status / active-issues / logs / ai-prompts / handoff
- 非対象:
  - metrics backend / metrics endpoint / dashboard / 本番alert設定
  - external queue / transactional outbox
  - visibility timeout / ack / nack / DLQ実装
  - application retry backoff
  - DB schema / migration / seed変更
  - Runner / hidden tests / auth / admin / UI / deployment変更
- 完了条件:
  - event nameとfieldをallowlistで固定する。
  - unknown / sensitive fieldを出力しない。
  - code / tests / secret / token / password / attempt key / raw error messageをログへ出さない。
  - enqueue / delivery / claim / retry / recoveryの主要結果をJSON Linesで記録する。
  - learner-safeレスポンスを変更しない。
  - 全品質ゲートとdocs validationを通過する。

## Recently Completed

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
  - `docs/logs/2026-07-23-issue-109-queue-operations-design.md`
  - `docs/ai-prompts/2026-07-23-issue-109-queue-operations-design-codex.md`
  - `docs/handoff/2026-07-23-issue-109-queue-operations-design-handoff.md`
- 反映内容: at-least-once delivery、ack、visibility timeout、transport/application retry、DLQ、transactional outbox、rollout / rollback方針を確定。

### #105 / PR #108 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-23
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/105`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/108`
- Linear mirror: `MIZ-34`（Done）
- 関連資料:
  - `docs/logs/2026-07-23-issue-105-stale-running-recovery-scanner.md`
  - `docs/ai-prompts/2026-07-23-issue-105-stale-running-recovery-scanner-codex.md`
  - `docs/handoff/2026-07-23-issue-105-stale-running-recovery-scanner-handoff.md`
- 反映内容: lease期限切れrunningだけをexpected attempt / key / lease expiry付きtransactionでnew attemptへ回収し、startup / periodic scanner、retry上限判定、再投入失敗終端化を実装した。

### #106 / PR #107 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-23
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/106`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/107`
- Linear: 新規mirrorはworkspace無料枠上限のため作成せず、MIZ-34へblocker情報を記録した。
- 関連資料:
  - `docs/logs/2026-07-23-issue-106-queued-retry-enqueue-failure-finalization.md`
  - `docs/ai-prompts/2026-07-23-issue-106-queued-retry-enqueue-failure-finalization-codex.md`
  - `docs/handoff/2026-07-23-issue-106-queued-retry-enqueue-failure-finalization-handoff.md`
- 反映内容: retry再投入失敗時に現在のqueued attemptだけをattempt/keyでfenceし、completion guardを維持したまま `infra_failed` へ終端化する経路を追加した。

### #102 / PR #104 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-23
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/102`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/104`
- Linear mirror: `MIZ-27`（Done）
- 反映内容: processing lease関連列、lease付きclaim、heartbeat、expected attempt/key/lease期限によるnon-terminal・terminal fencingを実装。

### #101 / PR #103 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed（docs-only）
- 完了日: 2026-07-22
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/101`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/103`
- Linear mirror: `MIZ-25`（Done）
- 反映内容: stale `running` / `legacy_running`、lease / heartbeat / attempt fencing、new attempt回収、rollout / rollback方針を確定。

### #99 / PR #100 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-22
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/99`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/100`
- Linear mirror: `MIZ-19`（Done）
- 反映内容: Worker起動時にDB上の `queued` submissionを回収し、条件付きclaimで二重採点を防止。

### #96 / PR #95 / #93 / #91 / #89 / #87 / #85 / #83 （完了済み）
- retry state machine、completion guard、SQLite migration順序、attempt単位idempotency key、重複採点防止設計を段階的に整備済み。
- 詳細は各Issueのlogs / ai-prompts / handoffおよびreportsを参照する。

## Next Issue Candidates

1. application retry backoff seam Issue（P1）
   - 優先理由: immediate retryを設定可能なexponential backoff + full jitterへ段階移行するため。
2. external queue / transactional outbox PoC Issue（P2）
   - 優先理由: 製品選定・dual-write対策・visibility / ack / DLQ contractを非本番で検証するため。
3. DLQ ops / replay / purge Issue（P2）
   - 優先理由: ops権限・監査・retentionを含む運用導線を整備するため。
4. queue metrics backend / dashboard / alert設定Issue（P2）
   - 優先理由: Issue #113のevent contractを実際の監視基盤へ接続するため。

## Branch Cleanup

- PR #112のhead branch `refactor/queue-contract-http-adapter` はbranch検索で見つからず、削除済み相当。
- Issue #113のhead branchは `feat/queue-transport-observability`。
- PR #114 merge後にIssue #113のhead branchを削除する。
