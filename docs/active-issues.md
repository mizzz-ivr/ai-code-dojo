# active-issues（正本）

最終更新: 2026-07-28（Issue #123 SQS consumer PoCを実装中）

## この文書の目的

進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #123 SQS consumerのlong polling・visibility延長・安全なack・DLQ契約を追加する

- 優先度: P2
- 状態: Open / Implementation
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/123`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/124`（Draft）
- 作業branch: `feat/sqs-consumer-poc`
- 目的: Issue #121のSQS producer runtimeと対になるWorker consumerを追加し、DB永続状態確認後のackとDLQ redrive前提の非削除契約を非本番で検証する。

#### 対象

- `WORKER_QUEUE_CONSUMER=http|sqs`
- SQS region / QueueUrl / long polling / visibility設定validation
- Worker process単位のSQS client生成・再利用・best-effort destroy
- `ReceiveMessage` / `ApproximateReceiveCount`
- SQS envelope / Body /共通message contract validation
- Processing中の`ChangeMessageVisibility`
- DB永続状態または安全なno-op確認後の`DeleteMessage`
- Ack deferred / poll / processing / visibility / ack structured event
- Consumer最小IAM policy例
- RedrivePolicy / maxReceiveCount / DLQ retention運用契約
- Unit / component integration / startup validation test
- Current-status / active-issues / system-overview / runbook / logs / ai-prompts / handoff

#### 非対象

- 実AWS source queue / DLQ / RedrivePolicy / IAM role / KMS key / VPC endpoint作成
- Production deployment切替
- LocalStack等の外部process integration
- DLQ replay / purge API・UI
- Worker HTTP endpoint廃止
- Worker application retry producerのSQS切替
- Outbox claim / lease
- Runner / hidden tests / auth / admin / learner UI変更
- DB schema / migration / seed変更

#### 完了条件

- HTTPが既定値で、HTTP選択時にAWS clientを生成しない。
- SQS設定不正時はWorkerがlisten前に失敗する。
- ReceiveMessageが一件ずつlong pollingする。
- Valid messageだけを既存processSubmissionへ渡す。
- Processing中にvisibilityをbest-effort延長する。
- Terminal保存、retry処理完了、安全なno-op確認後だけ最新ReceiptHandleでackする。
- Invalid message、unexpected error、DB ownership喪失、保存未確認ではdeleteしない。
- ReceiptHandle / QueueUrl / credentials / attempt key / code / tests / raw errorをeventへ出さない。
- DLQとsubmission `infra_failed`を分離する。
- Processing lease / attempt fencing / completion guardを変更しない。
- 全品質ゲートとdocs validationを通過する。

#### 現在の確認結果

- Lint / typecheck / unit / schema validation: Success
- 新規SQS consumer component integration: Success
- 初回integration全体: 既存stale recovery testで一時SQLite lock
- 対応: 無関係な修正を混在させず、final headで再確認

## Recently Completed

### #121 / PR #122（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/121`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/122`
- 反映内容: AWS SDK v3、API HTTP / SQS transport選択、SQS client lifecycle、legacy / outbox共通enqueue、producer最小IAMを実装した。

### #119 / PR #120（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-27
- 反映内容: Standard / FIFO対応SQS producer adapter、SHA-256 metadata、構造化event、outbox component integrationを実装した。

### #117 / PR #118（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-26
- 反映内容: Submissionとqueue publish intentのatomic保存、pending outbox dispatcher、at-least-once publishを実装した。

### #115 / PR #116（完了済み）

- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- 反映内容: Application retryへexponential backoff + full jitterを追加した。

### #113 / PR #114（完了済み）

- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- 反映内容: Queue経路をallowlist fieldのJSON Lines eventとして実装した。

### #111 / PR #112（完了済み）

- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-24
- 反映内容: Schema version 1のqueue message contract、producer port、HTTP adapterを実装した。

### #109 / PR #110（完了済み）

- 優先度: P1
- 状態: Closed / Merged / Completed（docs-only）
- 完了日: 2026-07-23
- 反映内容: At-least-once delivery、ack、visibility timeout、retry、DLQ、outbox方針を確定した。

## Next Issue Candidates

1. SQS source queue / DLQ / RedrivePolicy / IAM role / deployment IaC Issue（P2）
2. Worker application retry producerのqueue runtime統合Issue（P2）
3. DLQ replay / purge運用Issue（P2）
4. Outbox claim / lease Issue（P2）
5. Queue / outbox metrics backend Issue（P2）
6. Durable application retry scheduling Issue（P2）

## Branch Cleanup

- PR #122のhead branch `feat/sqs-runtime-wiring` は削除確認対象。
- Issue #123のhead branchは `feat/sqs-consumer-poc`。
- PR #124 merge後にIssue #123のhead branchを削除する。
