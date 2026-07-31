# active-issues（正本）

最終更新: 2026-07-31（Issue #129 / PR #130 Worker retry queue runtimeをレビュー中）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #129 Worker application retryを選択中のqueue runtimeへ統合する

- 優先度: P2
- 状態: Open / Ready for review
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/129`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/130`
- Notion: `https://app.notion.com/p/3ae7322f39fa81a59902f769db53cd76`
- Linear: 無料Issue上限により作成不可。GitHub / Repository docs / Notionを管理正本とする。
- Branch: `feat/worker-retry-queue-runtime`
- 目的: Workerが生成するapplication retry / stale recoveryを、`WORKER_QUEUE_CONSUMER`で選択中のHTTP / SQS runtimeへ統合する。

#### 対象

- Worker runtime `enqueue()` port
- Application retryへのruntime enqueue明示注入
- Stale scannerへの`enqueueAttempt`明示注入
- Process-global registrationを使用しない責務分離
- HTTP self-enqueue互換
- SQS consumer / retry producerのclient共有
- QueueUrl suffixによるStandard / FIFO判定
- FIFO MessageGroupId / MessageDeduplicationId契約再利用
- SendMessage失敗時の既存`infra_failed`終端化
- Worker roleへのsource queue `sqs:SendMessage`追加
- Customer managed KMS policy例の`kms:GenerateDataKey`
- Static IAM validation / security regression test
- Runbook / log / prompt / handoff / canonical docs / Notion

#### 非対象

- ECS task definition / service / cluster
- SQLiteからmanaged DBへの移行
- 実AWS deploy / transport切替
- Production environment
- Durable retry scheduling
- DLQ replay / purge
- Queue / outbox metrics backend・dashboard・alert
- Outbox claim / lease
- Runner / hidden tests / auth / admin / learner UI変更
- DB schema / migration / seed変更

#### 完了条件

- HTTP選択時にAWS clientを生成しない。
- HTTP retry / stale recoveryが既存`POST /jobs`を利用する。
- SQS選択時にconsumer / retry producerが同一clientを共有する。
- Application retryがruntime `enqueue()`を直接利用する。
- Stale recoveryが注入されたruntime `enqueue()`を利用する。
- Process-global producer registrationを使用しない。
- Runtime close時にclientを1回だけdestroyする。
- QueueUrlからStandard / FIFOを正しく判定する。
- FIFOで既存group / dedup contractを維持する。
- Application retry / stale recoveryが共通queue message contractを通る。
- Enqueue失敗を成功扱いにしない。
- Worker role actionがReceive / Delete / ChangeVisibility / Sendの完全一致になる。
- API producer roleはSendだけを維持する。
- Wildcard resource、DLQ read、PurgeQueue、queue管理権限を追加しない。
- QueueUrl / ReceiptHandle / credentials / raw attempt key / raw SDK errorをeventへ出さない。
- Processing lease / attempt fencing / completion guardを変更しない。
- HTTPを既定値・rollback先として維持する。
- 全品質ゲートが成功する。

#### 現在の確認結果

- GitHub Issue #129: Created
- GitHub PR #130: Draft解除対象 / mergeable
- Notion page: Created
- Linear Issue: 無料Issue上限により作成失敗
- HTTP self-enqueue test: Success
- Standard SQS retry enqueue test: Success
- FIFO group / dedup test: Success
- SQS client shared / single destroy test: Success
- Stale runtime enqueue injection test: Success
- Send failure sanitization test: Success
- Queue type startup validation: Success
- Worker IAM static validation: Success
- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- Integration test: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success
- Review thread: 0件
- 実AWS validation / transport切替: 未実施

## 保留Issue候補

### ECS task definitionへのrole関連付けとruntime environment注入

- 状態: Blocked / Design required
- 理由1: 現行は固定SQLite `.data/app.db`を使用し、API / Worker別taskで共有できない。
- 理由2: API / Workerを同一taskへ同居させるとtask roleが共通になり、producer / Worker最小権限分離を維持できない。
- 再開条件: Managed DB移行方針とAPI / Worker実行トポロジーが確定すること。

## Recently Completed

### #127 / PR #128（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-31（日本時間）
- 反映内容: staging GitHub OIDC trust、deployment role、CloudFormation execution role、review-only change set workflow、static validationを整備した。

### #125 / PR #126（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-30（日本時間）
- 反映内容: SQS source queue、DLQ、RedrivePolicy、TLS deny、workload IAM role、static validator、runbookをCloudFormation IaCとして整備した。

### #123 / PR #124（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
- 反映内容: Worker SQS consumer、long polling、visibility延長、安全なack、DLQ redrive前提の非削除契約を実装した。

### #121 / PR #122（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
- 反映内容: API HTTP / SQS transport選択、SQS client lifecycle、legacy / outbox共通enqueueを実装した。

### #119 / PR #120（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-27
- 反映内容: Standard / FIFO対応SQS producer adapter、構造化event、outbox integrationを実装した。

### #117 / PR #118（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-26
- 反映内容: Submissionとqueue publish intentのatomic保存、pending outbox dispatcherを実装した。

### #115 / PR #116（完了済み）

- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- 反映内容: Application retryへexponential backoff + full jitterを追加した。

## Next Issue Candidates

1. Managed DB移行・API / Worker実行トポロジー設計（P2）
2. DLQ replay / purge運用（P2）
3. Queue / outbox metrics backend・dashboard・alert（P2）
4. Outbox claim / lease（P2）
5. Durable application retry scheduling（P2）
6. ECS task definition / workload role wiring（設計確定までBlocked）

## Branch Cleanup

- PR #128のhead branch `feat/staging-oidc-change-set` は削除確認対象。
- Issue #129 / PR #130のhead branchは `feat/worker-retry-queue-runtime`。
- PR #130 merge後にhead branchを削除する。
