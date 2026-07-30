# current-status（正本）

最終更新: 2026-07-30（Issue #127 / PR #128 GitHub OIDC staging change setの品質ゲート成功）

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
- Issue #125 / PR #126でSQS source queue / DLQ / RedrivePolicy / IAM roleのCloudFormation IaCをmerge済み。
- Issue #127 / PR #128でstaging専用GitHub OIDC trust、deployment role、CloudFormation execution role、review-only change set workflowを実装し、全品質ゲート成功済み。
- Issue #127の設計・実装・PR・CI状況はNotionへ同期済み。
- Linearはworkspaceの無料Issue上限によりIssue #127を新規登録できないため、GitHub Issue / PR、Repository docs、Notionを管理正本とする。
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

- `infra/aws/cloudformation/sqs-queue-stack.json`を追加した。
- Standard / FIFOを`QueueType` parameterで選択可能にした。
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
- App qualityへ`infra-validation` jobを追加した。
- Build artifactへ`infra`を含めた。
- AWS CLI validate / change set / execute / rollback / retained queue cleanupをrunbook化した。

## Issue #127 / PR #128の変更

- `infra/aws/cloudformation/github-oidc-deployment-role-stack.json`を追加した。
- Existing GitHub OIDC provider ARNと実際のstaging subjectをparameterで受け取る。
- Subjectは`mizzz-ivr/ai-code-dojo`のlegacy形式、またはowner / repository IDを含むimmutable形式だけを許可する。
- OIDC trustは`aud=sts.amazonaws.com`とstaging subjectを`StringEquals`で完全一致させる。
- GitHub Actions deployment roleとCloudFormation execution roleを分離した。
- Deployment roleはtemplate validation、change set作成・参照、対象execution roleのPassRoleだけを許可する。
- Deployment roleへ`ExecuteChangeSet` / `CreateStack` / `UpdateStack` / `DeleteStack`を付与しない。
- CloudFormation execution roleはstaging grading queueと対象stack生成roleのresource範囲へ限定する。
- `.github/workflows/deploy-sqs-staging-change-set.yml`は`workflow_dispatch` / main / GitHub Environment `staging`専用とした。
- WorkflowはOIDC認証し、change setを作成・要約するがexecuteしない。
- AWS account IDをmaskし、QueueUrl / credentials / ARN実値をSummaryへ出さない。
- 手動入力はGitHub expressionから環境変数へ一度隔離し、shellへ直接埋め込まない。
- `DescribeChangeSet`はAWS認可仕様に合わせ、target stack ARNとchange set name conditionで限定する。
- OIDC trust、PassRole、権限allowlist、workflow trigger、長期credential不使用をstatic validatorで検査する。
- Security regression unit testを8件追加した。
- 実AWS bootstrap / change set / execute / production / ECS関連付けは対象外とする。

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
- GitHub OIDC trustはaud / sub完全一致とし、Environment protectionを併用する。
- Deployment roleとCloudFormation execution roleを分離する。
- Review-only workflowから実AWS resourceをexecuteしない。
- 通常PR CIからAWS APIを呼び出さない。

## Test・validation状況

Issue #127 / PR #128のfinal head `7294d3a413538e04de5c6930f328bfe758ca67ed` で以下は成功済み。

- Docs validation
- Frozen lockfile install
- Lint
- Typecheck
- Unit test
- Integration test
- Schema validation
- Infra validation
- Build

Static validationでは次を回帰検知する。

- OIDC subject default / wildcard / 別Repository指定
- OIDC aud / sub trust緩和
- Deployment roleへのchange set execute / stack mutation権限追加
- PassRole resource / service制約拡大
- CloudFormation execution roleのwildcard resource
- Workflowの自動trigger / 長期credential参照
- Workflow inputのshell直接展開
- 固定AWS account ID / access key混入

## 現時点の非対応・運用制約

- 実AWS accountへのOIDC bootstrap stack create / update / deleteは未実施。
- 実AWS accountへのSQS stack create / update / deleteは未実施。
- Production deploymentはHTTP producer / consumerのまま。
- GitHub Environment `staging`のvariables / branch protectionは未設定。
- ECS / Lambda / EC2 workloadとIAM roleの関連付けは未実装。
- VPC endpoint / network pathは未実装。
- Customer managed KMS key / key policyは未実装。
- DLQ replay / purge API・UIは未実装。
- Worker application retry producerはHTTP self-enqueueを維持する。
- Queue / outbox metrics backend、dashboard、alertは未実装。
- Outbox claim / leaseは未実装。
- Retained queueのinventory / cleanup運用が必要。
- Linearへの新規Issue登録は無料Issue上限により停止中。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## 優先順位（直近）

1. PR #128をレビュー・mergeする。
2. 別承認でstaging OIDC bootstrap / change set作成を実AWS検証する。
3. ECS task definitionへのproducer / consumer role関連付けとruntime environment注入を別Issueで整備する。
4. Worker application retry producerを選択queue runtimeへ統合する。
5. DLQ replay / purge運用を整備する。
6. Queue / outbox eventをmetrics backend / dashboard / alertへ接続する。
7. Outbox claim / leaseを追加する。
8. Runner隔離強化とhidden tests漏洩防止を継続する。

## Branch cleanup 状態

- PR #124のhead branch `feat/sqs-consumer-poc` は削除済み。
- PR #126は2026-07-30（日本時間）にmerge済み。
- PR #126のhead branch `feat/sqs-cloudformation-infra` は削除確認対象。
- Issue #127 / PR #128の作業branchは `feat/staging-oidc-change-set`。
- PR #128 merge後にhead branchを削除する。

## 参照先

- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #125: `https://github.com/mizzz-ivr/ai-code-dojo/issues/125`
- PR #126: `https://github.com/mizzz-ivr/ai-code-dojo/pull/126`
- Issue #127: `https://github.com/mizzz-ivr/ai-code-dojo/issues/127`
- PR #128: `https://github.com/mizzz-ivr/ai-code-dojo/pull/128`
- Notion #127: `https://app.notion.com/p/3ad7322f39fa813ab90ef7e9a7f64ec2`
- SQS CloudFormation template: `infra/aws/cloudformation/sqs-queue-stack.json`
- OIDC deployment template: `infra/aws/cloudformation/github-oidc-deployment-role-stack.json`
- Staging change set workflow: `.github/workflows/deploy-sqs-staging-change-set.yml`
- OIDC staging runbook: `docs/runbooks/2026-07-30-github-oidc-staging-change-set-runbook.md`
- SQS consumer runbook: `docs/runbooks/2026-07-28-sqs-consumer-poc-runbook.md`
- Queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
