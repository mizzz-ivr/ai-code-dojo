# current-status（正本）

最終更新: 2026-07-28（Issue #125 SQS CloudFormation infrastructureを実装中）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）

- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ai-code-dojoは、AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- Docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Queue message contract、producer / consumer runtime、構造化event、application retry backoff、transactional outboxまで実装済み。
- Issue #119 / PR #120でSQS producer adapter PoCをmerge済み。
- Issue #121 / PR #122でAWS SDK v3とAPI queue transport runtime wiringをmerge済み。
- Issue #123 / PR #124でWorker SQS consumer PoCをmerge済み。
- Issue #125 / PR #126でSQS source queue / DLQ / RedrivePolicy / IAM roleのCloudFormation IaCを実装中。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## 実装済みのqueue runtime

### Producer

- Queue message schema version 1はsubmission ID / grading attempt / attempt idempotency key / optional correlation IDだけを許可する。
- `API_QUEUE_TRANSPORT`の既定値は`http`であり、既存HTTP adapterをrollback先として維持する。
- SQS選択時は`API_QUEUE_OUTBOX_ENABLED=1`を必須とする。
- API process単位で一つの`SQSClient`を生成し、legacy enqueueとoutbox dispatcherで共有する。
- AWS credentialsはAWS SDK v3のdefault credential provider chainへ委譲する。
- SQS send成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。

### Consumer

- `WORKER_QUEUE_CONSUMER`の既定値は`http`であり、`POST /jobs`をrollback先として維持する。
- SQSでは一件ずつlong pollingし、共通queue message contractで検証する。
- Processing中はqueue visibilityをbest-effort延長する。
- DB terminal保存、retry処理完了、安全なno-op確認後だけ最新ReceiptHandleで`DeleteMessage`する。
- Invalid message、unexpected error、DB ownership喪失、保存未確認ではmessageを削除しない。
- DB processing lease / attempt fencing / completion guardを採点correctnessの正本として維持する。

## Issue #125 / PR #126の変更

- `infra/aws/cloudformation/sqs-queue-stack.json`を追加する。
- Standard / FIFOを`QueueType` parameterで選択可能にする。
- Source queueとDLQを同じqueue typeで作成する。
- Source queueはretention 4日、long polling 20秒、visibility 90秒とする。
- DLQはretention 14日、`RedriveAllowPolicy=byQueue`とする。
- `MaxReceiveCount`既定値を5とする。
- Source / DLQ双方でSQS-managed SSEを有効化する。
- Queue policyで`aws:SecureTransport=false`を拒否する。
- Producer roleはsource queueへの`SendMessage`だけを許可する。
- Consumer roleはsource queueへの`ReceiveMessage` / `DeleteMessage` / `ChangeMessageVisibility`だけを許可する。
- Queue削除・置換時は`Retain`してmessage消失を防ぐ。
- Stack outputsでQueueUrl / QueueArn / RoleArn / runtime設定例を提供する。
- `pnpm infra:validate`でAWS credentials不要のstatic validationを行う。
- App qualityへ`infra-validation` jobを追加する。
- Build artifactへ`infra`を含める。
- AWS CLI validate / change set / execute / rollback / retained queue cleanupをrunbook化する。

## Correctness・セキュリティ境界

- Queue visibility timeoutはdelivery availabilityを担う。
- DB processing leaseはcurrent attemptの実行所有権を担う。
- Attempt idempotency keyとcompletion guardが採点correctnessを担う。
- Exactly-once publish / deliveryへ依存しない。
- Transport retryでgrading attempt / attempt keyを変更しない。
- Queue message / eventへcode / tests / secret / credentials / QueueUrl / ReceiptHandle / raw attempt key / raw SDK errorを記録しない。
- Learnerへqueue / outbox / DLQ / delivery count / internal errorを返さない。
- DLQとsubmission `infra_failed`を分離する。
- Producer / consumer roleを分離し、wildcard resource、PurgeQueue、queue管理、DLQ read権限を付与しない。
- CIから実AWS resourceを作成しない。

## Test・validation状況

Initial PR headで以下は成功済み。

- Docs validation
- Frozen lockfile install
- Lint
- Typecheck
- Unit test
- Integration test
- Schema validation
- Infra validation
- Build

Static validatorは次を検査する。

- CloudFormation JSON構文
- Standard / FIFO命名とtype一致
- SSE / retention / long polling / visibility
- RedrivePolicy / RedriveAllowPolicy
- Source ARN組み立てによる循環依存回避
- TLS deny
- IAM action / resource完全一致
- Stack outputs
- Literal account ID / access key ID不在

## 現時点の非対応・運用制約

- 実AWS accountへのstack create / update / deleteは未実施。
- Production deploymentはHTTP producer / consumerのまま。
- GitHub OIDC provider / deployment roleは未実装。
- ECS / Lambda / EC2 workloadとIAM roleの関連付けは未実装。
- VPC endpoint / network pathは未実装。
- Customer managed KMS key / key policyは未実装。
- DLQ replay / purge API・UIは未実装。
- Worker application retry producerはHTTP self-enqueueを維持する。
- Queue / outbox metrics backend、dashboard、alertは未実装。
- Outbox claim / leaseは未実装。
- Retained queueのinventory / cleanup運用が必要。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## 優先順位（直近）

1. Issue #125 / PR #126をfinal CI成功・Ready for reviewへ進める。
2. 限定環境のdeployment wiringとGitHub OIDC deployment roleを別Issueで整備する。
3. Worker application retry producerを選択queue runtimeへ統合する。
4. DLQ replay / purge運用を整備する。
5. Queue / outbox eventをmetrics backend / dashboard / alertへ接続する。
6. Outbox claim / leaseを追加する。
7. Runner隔離強化とhidden tests漏洩防止を継続する。

## Branch cleanup 状態

- PR #124は2026-07-28（日本時間）にmerge済み。
- PR #124のhead branch `feat/sqs-consumer-poc` は削除済み。
- Issue #125の作業branchは `feat/sqs-cloudformation-infra`。
- PR #126 merge後にhead branchを削除する。

## 参照先

- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #125: `https://github.com/mizzz-ivr/ai-code-dojo/issues/125`
- PR #126: `https://github.com/mizzz-ivr/ai-code-dojo/pull/126`
- CloudFormation template: `infra/aws/cloudformation/sqs-queue-stack.json`
- CloudFormation runbook: `docs/runbooks/2026-07-28-sqs-cloudformation-infra-runbook.md`
- SQS consumer runbook: `docs/runbooks/2026-07-28-sqs-consumer-poc-runbook.md`
- Queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
