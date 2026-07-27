# active-issues（正本）

最終更新: 2026-07-27（Issue #121 SQS runtime wiringをレビュー中）

## この文書の目的
進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義
- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #121 SQS producerをAWS SDKへ接続しAPI queue transportを安全に切り替え可能にする
- 優先度: P2
- 状態: Open / Review
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/121`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/122`（Ready for review）
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
- 現在の確認結果:
  - docs validation: Success
  - frozen lockfile install: Success
  - lint / typecheck / unit / integration / schema validation / build: Success

## Recently Completed

### #119 / PR #120 （完了済み）
- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-27
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/119`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/120`
- 反映内容: Standard / FIFO対応のSQS producer adapter、SHA-256 group / deduplication metadata、構造化event、outbox component integration testを実装した。

### #117 / PR #118 （完了済み）
- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-26
- 反映内容: submissionとqueue publish intentのatomic保存、pending outbox dispatcher、at-least-once publishを実装した。

### #115 / PR #116 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- 反映内容: application retryへexponential backoff + full jitterを追加した。

### #113 / PR #114 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- 反映内容: queue経路をallowlist fieldのJSON Lines eventとして実装した。

### #111 / PR #112 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-24
- 反映内容: schema version 1のqueue message contract、producer port、HTTP adapterを実装した。

### #109 / PR #110 （完了済み）
- 優先度: P1
- 状態: Closed / Merged / Completed（docs-only）
- 完了日: 2026-07-23
- 反映内容: at-least-once delivery、ack、visibility timeout、retry、DLQ、outbox方針を確定した。

## Next Issue Candidates

1. SQS consumer / visibility timeout / DeleteMessage / DLQ PoC Issue（P2）
2. SQS resource / IAM role / deployment IaC Issue（P2）
3. outbox claim / lease Issue（P2）
4. queue / outbox metrics backend Issue（P2）
5. durable application retry scheduling Issue（P2）

## Branch Cleanup

- PR #120のhead branch `feat/sqs-producer-adapter-poc` は削除確認対象。
- Issue #121のhead branchは `feat/sqs-runtime-wiring`。
- PR #122 merge後にIssue #121のhead branchを削除する。
