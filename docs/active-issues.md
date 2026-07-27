# active-issues（正本）

最終更新: 2026-07-26（Issue #119 SQS producer adapter PoCをレビュー中）

## この文書の目的
進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義
- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #119 SQS producer adapterの非本番PoCとtransport contractを追加する
- 優先度: P2
- 状態: Open / Review
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/119`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/120`（Ready for review）
- 作業branch: `feat/sqs-producer-adapter-poc`
- 目的: transactional outbox dispatcher配下へ注入可能なSQS producer adapterを追加し、AWS runtime wiring前にtransport contractを非本番で検証する。
- 対象:
  - `createSqsQueueProducer`
  - Standard / FIFO SendMessage input builder
  - queue message schema version 1の共通validation
  - client / command factory injection
  - Standard queueのQueueUrl / MessageBody contract
  - FIFOのSHA-256 MessageGroupId / MessageDeduplicationId
  - MessageId取得時だけのpublish成功判定
  - SQS transport structured event
  - outbox dispatcherのtransport注入
  - unit / component integration test
  - current-status / active-issues / system-overview / runbook / logs / ai-prompts / handoff
- 非対象:
  - `@aws-sdk/client-sqs`依存追加
  - AWS credentials / IAM role / KMS / VPC endpoint設定
  - 本番SQS queue作成
  - API runtime transport切替
  - SQS consumer / ReceiveMessage / DeleteMessage
  - visibility timeout / ack / nack / DLQ
  - LocalStack等の外部process integration
  - deployment変更
  - outbox claim / lease
  - Runner / hidden tests / auth / admin / learner UI変更
- 完了条件:
  - adapterが`enqueue(message) -> boolean`を満たす。
  - Standard / FIFO queue typeとQueueUrlを検証する。
  - FIFO metadataへraw submission ID / attempt keyを露出しない。
  - SDK例外・MessageId欠落・contract不正をfalseへ正規化する。
  - queue URL、credentials、attempt key、code、tests、raw error messageをeventへ出さない。
  - outbox dispatcherへSQS producerを注入してpublished更新までcomponent testする。
  - 現行HTTP runtime、processing lease、attempt fencing、completion guardを変更しない。
  - 全品質ゲートとdocs validationを通過する。

## Recently Completed

### #117 / PR #118 （完了済み）
- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-26
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/117`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/118`
- 関連資料:
  - `docs/runbooks/2026-07-25-transactional-outbox-runbook.md`
  - `docs/logs/2026-07-25-issue-117-transactional-outbox-poc.md`
  - `docs/ai-prompts/2026-07-25-issue-117-transactional-outbox-poc-codex.md`
  - `docs/handoff/2026-07-25-issue-117-transactional-outbox-poc-handoff.md`
- 反映内容: submissionとqueue publish intentのatomic保存、pending outbox dispatcher、feature flag、at-least-once publish、migration / unit / integration testを実装した。

### #115 / PR #116 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/115`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/116`
- 反映内容: application retryへfeature flag付きexponential backoff + full jitterを追加し、共有SQLite integration suiteを独立processで直列実行するrunnerへ安定化した。

### #113 / PR #114 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`
- 反映内容: enqueue / delivery / claim / heartbeat / retry / queued recovery / stale recoveryをallowlist fieldのJSON Lines eventとして実装した。

### #111 / PR #112 （完了済み）
- 優先度: P1
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

1. AWS SDK runtime wiring / IAM / deployment Issue（P2）
   - 優先理由: Issue #119の注入型adapterへ`@aws-sdk/client-sqs`と実際の設定読込を接続し、限定環境でpublishできる状態にするため。
2. SQS consumer / visibility timeout / ack / DLQ PoC Issue（P2）
   - 優先理由: producerだけでなくReceiveMessage / DeleteMessage、redelivery、DLQ contractを非本番で検証するため。
3. outbox claim / lease Issue（P2）
   - 優先理由: 複数API processで同じpending rowを同時publishする競合を制御するため。
4. queue / outbox metrics backend Issue（P2）
   - 優先理由: pending count / oldest age / publish failureをdashboardとalertへ接続するため。
5. durable application retry scheduling Issue（P2）
   - 優先理由: process内best-effort delayをexternal queueまたは永続化時刻へ移行するため。

## Branch Cleanup

- PR #118のhead branch `feat/transactional-outbox-poc` は削除確認対象。
- Issue #119のhead branchは `feat/sqs-producer-adapter-poc`。
- PR #120 merge後にIssue #119のhead branchを削除する。
