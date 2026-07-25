# active-issues（正本）

最終更新: 2026-07-25（Issue #117 transactional outbox PoCをレビュー準備中）

## この文書の目的
進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義
- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #117 submission作成とqueue publishのdual-writeをtransactional outboxで解消する
- 優先度: P2
- 状態: Open / In Progress
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/117`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/118`（Draft）
- 作業branch: `feat/transactional-outbox-poc`
- 目的: submission保存とqueue publish intentを同一SQLite transactionで確定し、publish失敗時もpending outboxから再送可能にする。
- 対象:
  - `queue_outbox` table / pending検索index
  - `(submission_id, grading_attempt)` unique constraint
  - submission + outbox atomic transaction
  - `API_QUEUE_OUTBOX_ENABLED`
  - polling interval / batch size validation
  - API起動時 / submission直後 / interval dispatcher
  - 既存HTTP queue producer portへのpublish
  - publish成功時のpublished更新
  - publish失敗時のpending維持・attempt count・一般化error type
  - outbox structured event
  - unit / integration / migration test
  - current-status / active-issues / system-overview / runbook / logs / ai-prompts / handoff
- 非対象:
  - SQS / RabbitMQ / Redis Streams等の実broker導入
  - visibility timeout / ack / nack / DLQ実装
  - replay / purge UI・API
  - PostgreSQL等への移行
  - durable application retry scheduling
  - Runner / hidden tests / auth / admin / learner UI / deployment変更
- 完了条件:
  - submission rowとoutbox rowが同一transactionでcommit / rollbackされる。
  - feature flag無効時は既存の保存→同期HTTP enqueueと502挙動を維持する。
  - feature flag有効時はatomic保存成功後、publish失敗でも201で受理する。
  - pending dispatcherが既存queue producer portを利用する。
  - publish成功時だけpublishedへ更新する。
  - publish失敗時はpendingを維持する。
  - duplicate publishでgrading attempt / attempt keyを変更しない。
  - Worker conditional claim / attempt fencing / completion guardを維持する。
  - learner responseへoutbox情報を追加しない。
  - code / tests / secret / attempt key / raw error messageをeventへ出さない。
  - 全品質ゲートとdocs validationを通過する。

## Recently Completed

### #115 / PR #116 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/115`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/116`
- 関連資料:
  - `docs/runbooks/2026-07-25-application-retry-backoff-runbook.md`
  - `docs/logs/2026-07-25-issue-115-application-retry-backoff.md`
  - `docs/ai-prompts/2026-07-25-issue-115-application-retry-backoff-codex.md`
  - `docs/handoff/2026-07-25-issue-115-application-retry-backoff-handoff.md`
- 反映内容: application retryへfeature flag付きexponential backoff + full jitterを追加し、共有SQLite integration suiteを独立processで直列実行するrunnerへ安定化した。

### #113 / PR #114 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`
- 反映内容: enqueue / delivery / claim / heartbeat / retry / queued recovery / stale recoveryをallowlist fieldのJSON Lines eventとして実装した。

### #111 / PR #112 （完了済み）
- 優度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-24
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/111`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/112`
- 反映内容: schema version 1のqueue message contract、producer port、HTTP adapter、producer / consumer共通validationを実装した。

### #109 / PR #110 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed（docs-only）
- 完了日: 2026-07-23
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/109`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/110`
- 反映内容: at-least-once delivery、ack、visibility timeout、transport/application retry、DLQ、transactional outbox、rollout / rollback方針を確定した。

### #105 / PR #108 / #106 / PR #107 / #102 / PR #104 （完了済み）
- processing lease、heartbeat、attempt fencing、stale recovery、queued retry enqueue failure終端化を段階的に整備済み。
- 詳細は各Issueのlogs / ai-prompts / handoffおよびreportsを参照する。

## Next Issue Candidates

1. external queue adapter / broker PoC Issue（P2）
   - 優先理由: Issue #117のoutbox dispatcher配下へHTTP以外のproducer adapterを追加し、非本番でdelivery contractを検証するため。
2. DLQ ops / replay / purge Issue（P2）
   - 優先理由: ops権限・監査・retentionを含む運用導線を整備するため。
3. queue metrics backend / dashboard / alert設定Issue（P2）
   - 優先理由: queue / outbox event contractを実際の監視基盤へ接続するため。
4. durable application retry scheduling Issue（P2）
   - 優先理由: process内best-effort delayを外部queueまたは永続化時刻へ移行するため。

## Branch Cleanup

- PR #116のhead branch `feat/application-retry-backoff` は削除確認対象。
- Issue #117のhead branchは `feat/transactional-outbox-poc`。
- PR #118 merge後にIssue #117のhead branchを削除する。
