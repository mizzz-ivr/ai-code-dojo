# current-status（正本）

最終更新: 2026-07-31（Issue #129 / PR #130 Worker retry queue runtimeをレビュー中）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）

- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- Docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Queue message contract、HTTP / SQS producer / consumer、構造化event、application retry backoff、transactional outboxまで実装済み。
- Issue #125 / PR #126でSQS source queue / DLQ / RedrivePolicy / workload IAM roleのCloudFormation IaCをmerge済み。
- Issue #127 / PR #128でstaging GitHub OIDC認証とreview-only change set workflowをmerge済み。
- Issue #129 / PR #130でWorker application retry / stale recoveryを選択中queue runtimeへ統合し、依存注入後の品質ゲート成功済み。
- Linearは無料Issue上限のためIssue #129を登録できず、GitHub / Repository docs / Notionを管理正本とする。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## Queue runtime

### API producer

- `API_QUEUE_TRANSPORT=http|sqs`。
- 既定値は`http`。
- SQS選択時はtransactional outboxを必須とする。
- API process単位で1つのSQS clientを生成し、legacy enqueueとoutbox dispatcherで共有する。
- SQS send成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。

### Worker consumer

- `WORKER_QUEUE_CONSUMER=http|sqs`。
- 既定値は`http`。
- HTTPでは`POST /jobs`をrollback先として維持する。
- SQSでは1件ずつlong pollingし、processing中にvisibilityをbest-effort延長する。
- DB terminal保存、retry処理完了、安全なno-op確認後だけ最新ReceiptHandleでDeleteMessageする。
- Invalid message、unexpected error、DB ownership喪失、保存未確認ではmessageを削除しない。

### Worker-origin requeue（Issue #129 / PR #130）

- Worker runtimeは選択transportのproducerを保持し、`enqueue()` portを提供する。
- Application retryはserverからruntime `enqueue()`を直接呼ぶ。
- Stale recoveryはscanner起動時にruntime `enqueue()`を`enqueueAttempt`として注入する。
- Process-global registrationや共有可変singletonは使用しない。
- HTTP選択時は既存HTTP self-enqueueを利用する。
- SQS選択時はconsumerとretry producerで同一SQS client / QueueUrlを共有する。
- QueueUrl末尾`.fifo`からStandard / FIFOを判定する。
- FIFO時は既存SQS producerのMessageGroupId / MessageDeduplicationId契約を再利用する。
- Runtime close時はpoll停止後にclientを1回だけdestroyする。
- SendMessage失敗時は成功扱いせず、既存の`infra_failed`安全終端化を維持する。

## SQS infrastructure / IAM

- Source queue retention 4日、long polling 20秒、visibility 90秒。
- DLQ retention 14日、`RedriveAllowPolicy=byQueue`、`MaxReceiveCount`既定5。
- Source / DLQでSQS-managed SSEとTLS denyを有効化する。
- Queue削除・置換時はRetainする。
- API producer roleはsource queueへの`sqs:SendMessage`だけを許可する。
- Worker roleはsource queueへの以下だけを許可する。
  - `sqs:ReceiveMessage`
  - `sqs:DeleteMessage`
  - `sqs:ChangeMessageVisibility`
  - `sqs:SendMessage`
- Wildcard resource、DLQ read、PurgeQueue、queue管理権限を付与しない。
- Customer managed KMS policy例ではWorker retry送信用に`kms:GenerateDataKey`を含める。現行既定はSQS-managed SSE。

## Deployment

- PR #128でGitHub OIDC deployment roleとCloudFormation execution roleを分離した。
- OIDC trustは`aud` / `sub`完全一致でstaging Environmentへ限定する。
- Review-only workflowはchange set作成・要約まででexecuteしない。
- Production transportはHTTPのまま。
- 実AWS OIDC bootstrap / SQS change set / transport切替は未実施。

## ECS wiring保留

- 現行DBはprocess working directory配下の固定SQLite `.data/app.db`。
- API / Workerを別ECS taskへ分離するとDB fileを共有できない。
- API / Workerを同一taskへ同居させるとtask roleが共通になり、producer / Worker権限分離を維持できない。
- Managed DB移行または実行トポロジー確定まで、ECS task definition / service wiringを実装しない。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## Correctness・セキュリティ境界

- Queue visibility timeoutはdelivery availabilityを担う。
- DB processing leaseはcurrent attemptの実行所有権を担う。
- Attempt idempotency keyとcompletion guardが採点correctnessを担う。
- Exactly-once publish / deliveryへ依存しない。
- Transport retryでgrading attempt / attempt keyを変更しない。
- Queue message / eventへcode / tests / credentials / QueueUrl / ReceiptHandle / raw attempt key / raw SDK errorを記録しない。
- Learnerへqueue / outbox / DLQ / delivery count / internal errorを返さない。
- DLQとsubmission `infra_failed`を分離する。
- HTTP producer / consumerを安全なrollback先として維持する。

## Issue #129 / PR #130のテスト状況

依存注入後のcode headで以下は成功済み。

- Frozen lockfile install
- Lint
- Typecheck
- Unit test
- Integration test
- Schema validation
- Infra validation

追加した主な回帰観点:

- HTTP選択時にAWS clientを生成しない。
- Standard SQS retry enqueue。
- FIFO group / dedup contract。
- Consumer / retry producerのclient共有。
- Client single destroy。
- Queue type欠落のstartup rejection。
- Stale scannerが注入されたruntime enqueueを利用する。
- Send失敗時のraw error非露出。
- Worker roleのSendMessage欠落・権限拡大検知。

Final docs headでBuildを含む全品質ゲートを再確認する。

## 現時点の非対応・運用制約

- 実AWS accountへのstack create / update / delete。
- Production transport切替。
- ECS task definition / service / cluster。
- Managed DB移行。
- VPC endpoint / network path。
- Customer managed KMS key / key policy本体。
- DLQ replay / purge API・UI。
- Queue / outbox metrics backend、dashboard、alert。
- Outbox claim / lease。
- Durable application retry scheduling。
- Retained queue inventory / cleanup自動化。
- Linear新規Issue登録。

## 優先順位（直近）

1. PR #130をレビュー・mergeする。
2. Managed DB移行とAPI / Worker実行トポロジーを設計する。
3. 設計確定後にECS task definition / workload role wiringを再評価する。
4. DLQ replay / purge運用を整備する。
5. Queue / outbox eventをmetrics backend / dashboard / alertへ接続する。
6. Outbox claim / leaseを追加する。
7. Durable application retry schedulingを検討する。
8. Runner隔離強化とhidden tests漏洩防止を継続する。

## Branch cleanup

- PR #128は2026-07-31（日本時間）にmerge済み。
- PR #128のhead branch `feat/staging-oidc-change-set` は削除確認対象。
- Issue #129 / PR #130のbranchは `feat/worker-retry-queue-runtime`。
- PR #130 merge後にhead branchを削除する。

## 参照先

- Issue #129: `https://github.com/mizzz-ivr/ai-code-dojo/issues/129`
- PR #130: `https://github.com/mizzz-ivr/ai-code-dojo/pull/130`
- Notion #129: `https://app.notion.com/p/3ae7322f39fa81a59902f769db53cd76`
- Architecture: `docs/architecture/worker-origin-requeue.md`
- Runbook: `docs/runbooks/2026-07-31-worker-retry-queue-runtime-runbook.md`
- SQS template: `infra/aws/cloudformation/sqs-queue-stack.json`
- Worker runtime: `apps/worker/src/services/queue-consumer-runtime.mjs`
