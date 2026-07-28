# active-issues（正本）

最終更新: 2026-07-28（Issue #125 SQS CloudFormation infrastructureをレビュー中）

## この文書の目的

進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #125 SQS source queue・DLQ・RedrivePolicy・最小IAM roleをCloudFormationで管理する

- 優先度: P2
- 状態: Open / Review
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/125`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/126`（Ready for review）
- 作業branch: `feat/sqs-cloudformation-infra`
- 目的: Issue #123で完成したSQS producer / consumer runtimeに対応するsource queue、DLQ、redrive、TLS deny、producer / consumer workload roleを再現可能なCloudFormationとして管理する。

#### 対象

- `infra/aws/cloudformation/sqs-queue-stack.json`
- Standard / FIFO condition
- Source queue / DLQ同一type
- Source retention 4日
- DLQ retention 14日
- Long polling 20秒
- Visibility timeout 90秒
- `MaxReceiveCount` parameter（既定5）
- DLQ `RedriveAllowPolicy=byQueue`
- SQS-managed SSE
- Source / DLQ共通TLS deny queue policy
- Producer role: sourceへの`sqs:SendMessage`
- Consumer role: sourceへの`sqs:ReceiveMessage` / `sqs:DeleteMessage` / `sqs:ChangeMessageVisibility`
- Workload trust principal parameter
- Queue / role / runtime設定stack outputs
- Queue削除・置換時のRetain
- AWS credentials不要のstatic validator
- Validator security regression unit test
- App quality `infra-validation` job
- Build artifactへのinfra追加
- AWS CLI validate / change set / execute / rollback / cleanup runbook
- Current-status / active-issues / system-overview / logs / ai-prompts / handoff

#### 非対象

- 実AWS accountへのstack deploy
- Production transport切替
- GitHub Actions AWS deploy / GitHub OIDC provider / deployment role
- ECS / Lambda / EC2 / VPC resource
- Customer managed KMS key / key policy
- DLQ replay / purge API・UI
- Queue metrics / dashboard / alert
- Worker application retry producerのSQS切替
- Outbox claim / lease
- Runner / hidden tests / auth / admin / learner UI変更
- DB schema / migration / seed変更

#### 完了条件

- Source / DLQ双方でStandard / FIFO typeと命名が一致する。
- SourceからDLQへのRedrivePolicyが設定される。
- DLQはsource queueだけを`byQueue`で許可する。
- Source / DLQ双方でSQS-managed SSEとTLS denyを設定する。
- Producer / consumer roleを分離し、source ARNだけに最小actionを許可する。
- RoleNameを固定せず、deploy時は`CAPABILITY_IAM`を使用する。
- Queue削除・置換でRetainする。
- Runtime設定に利用できるoutputsを提供する。
- `pnpm infra:validate`でsecurity・operations契約を検証する。
- Static validatorの正常系・改変検知unit testを追加する。
- CIから実AWS resourceを作成しない。
- AWS CLIのchange set reviewとrollbackをrunbook化する。
- 全品質ゲートとdocs validationを通過する。

#### 現在の確認結果

Final PR head:

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit: Success
- Integration: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success

Integrationはdocs更新後の初回実行で一時失敗したが、failed jobのみ再実行して成功を確認した。

## Recently Completed

### #123 / PR #124（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/123`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/124`
- 反映内容: Worker SQS consumer、long polling、visibility延長、DB永続状態確認後のDeleteMessage、DLQ redrive前提の非削除契約を実装した。

### #121 / PR #122（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
- 反映内容: AWS SDK v3、API HTTP / SQS transport選択、SQS client lifecycle、legacy / outbox共通enqueue、producer最小IAM例を実装した。

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

1. 限定環境のdeployment wiring / GitHub OIDC deployment role / ECS task role関連付け（P2）
2. Worker application retry producerのqueue runtime統合（P2）
3. DLQ replay / purge運用（P2）
4. Queue / outbox metrics backend・dashboard・alert（P2）
5. Outbox claim / lease（P2）
6. Durable application retry scheduling（P2）

## Branch Cleanup

- PR #124のhead branch `feat/sqs-consumer-poc` は削除済み。
- Issue #125のhead branchは `feat/sqs-cloudformation-infra`。
- PR #126 merge後にIssue #125のhead branchを削除する。
