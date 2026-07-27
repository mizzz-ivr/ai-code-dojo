# active-issues（正本）

最終更新: 2026-07-27（Issue #121 SQS runtime wiringをレビュー準備中）

## この文書の目的
進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義
- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #121 SQS producerをAWS SDKへ接続しAPI queue transportを安全に切り替え可能にする
- 優先度: P2
- 状態: Open / Implementation
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/121`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/122`（Draft）
- 作業branch: `feat/sqs-runtime-wiring`
- 目的: Issue #119のSQS producer adapterへAWS SDK v3を接続し、HTTPを既定値・rollback先として維持しながらAPI起動時にtransportを選択できるようにする。
- 対象:
  - `@aws-sdk/client-sqs`依存とfrozen lockfile
  - `API_QUEUE_TRANSPORT=http|sqs`
  - SQS region / QueueUrl / queue type validation
  - SQS利用時のtransactional outbox必須化
  - API process単位のSQS client生成・再利用・best-effort destroy
  - legacy submission / outbox dispatcher共通runtime enqueue
  - default credential provider chain利用
  - 対象queueへの`SendMessage`だけを許可するIAM policy例
  - customer managed KMS key利用時の追加policy例
  - unit / component integration / startup configuration test
  - current-status / active-issues / system-overview / runbook / logs / ai-prompts / handoff
- 非対象:
  - 実AWS SQS queue / IAM role / KMS key / VPC endpoint作成
  - static access keyの保存・配布
  - production deployment切替
  - SQS consumer / ReceiveMessage / DeleteMessage
  - visibility timeout / long polling / DLQ
  - Worker HTTP endpoint廃止
  - LocalStack等の外部process integration
  - outbox claim / lease
  - Runner / hidden tests / auth / admin / learner UI変更
- 完了条件:
  - HTTPが既定値で、HTTP選択時にAWS clientを生成しない。
  - SQS選択時だけoutbox、region、HTTPS QueueUrl、Standard / FIFO整合性を検証する。
  - legacy submissionとoutbox dispatcherが同じqueue runtimeを利用する。
  - SQS send成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。
  - credentials / QueueUrl / attempt key / code / tests / raw errorをeventへ出さない。
  - producer IAMへconsumer・purge・queue管理権限を付与しない。
  - processing lease / attempt fencing / completion guardを変更しない。
  - 全品質ゲートとdocs validationを通過する。

## Recently Completed

### #119 / PR #120 （完了済み）
- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-27
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/119`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/120`
- 関連資料:
  - `docs/runbooks/2026-07-26-sqs-producer-adapter-poc-runbook.md`
  - `docs/logs/2026-07-26-issue-119-sqs-producer-adapter-poc.md`
  - `docs/ai-prompts/2026-07-26-issue-119-sqs-producer-adapter-poc-codex.md`
  - `docs/handoff/2026-07-26-issue-119-sqs-producer-adapter-poc-handoff.md`
- 反映内容: Standard / FIFO対応のSQS producer adapter、SHA-256 group / deduplication metadata、構造化event、outbox component integration testを実装した。

### #117 / PR #118 （完了済み）
- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-26
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/117`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/118`
- 反映内容: submissionとqueue publish intentのatomic保存、pending outbox dispatcher、feature flag、at-least-once publish、migration / unit / integration testを実装した。

### #115 / PR #116 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/115`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/116`
- 反映内容: application retryへfeature flag付きexponential backoff + full jitterを追加した。

### #113 / PR #114 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`
- 反映内容: queue経路をallowlist fieldのJSON Lines eventとして実装した。

### #111 / PR #112 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-24
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/111`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/112`
- 反映内容: schema version 1のqueue message contract、producer port、HTTP adapter、共通validationを実装した。

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

1. SQS consumer / visibility timeout / DeleteMessage / DLQ PoC Issue（P2）
   - 優先理由: producer runtime wiring後にredelivery・ack・failure isolationを非本番で検証するため。
2. outbox claim / lease Issue（P2）
   - 優先理由: 複数API processで同じpending rowを同時publishする競合を制御するため。
3. queue / outbox metrics backend Issue（P2）
   - 優先理由: pending count / oldest age / publish failureをdashboardとalertへ接続するため。
4. durable application retry scheduling Issue（P2）
   - 優先理由: process内best-effort delayをexternal queueまたは永続化時刻へ移行するため。
5. SQS resource / IAM role / deployment IaC Issue（P2）
   - 優先理由: runtimeコードとAWS resource変更を分離し、環境差分・権限・rollbackをレビューしやすくするため。

## Branch Cleanup

- PR #120のhead branch `feat/sqs-producer-adapter-poc` は削除確認対象。
- Issue #121のhead branchは `feat/sqs-runtime-wiring`。
- PR #122 merge後にIssue #121のhead branchを削除する。
