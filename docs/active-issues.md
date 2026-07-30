# active-issues（正本）

最終更新: 2026-07-30（Issue #127 GitHub OIDC staging change setを実装中）

## この文書の目的

進行中/未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ/可用性/法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #127 限定環境向けGitHub OIDC認証とSQS change set workflowを整備する

- 優先度: P2
- 状態: Open / Implementation
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/127`
- GitHub PR: 作成予定
- Notion: `https://app.notion.com/p/3ad7322f39fa813ab90ef7e9a7f64ec2`
- Linear: workspaceの無料Issue上限により新規登録不可。GitHub / Repository docs / Notionを管理正本とする。
- 作業branch: `feat/staging-oidc-change-set`
- 目的: staging専用のGitHub OIDC trust、deployment role、CloudFormation execution role、review-only change set workflowを整備し、長期AWS access keyなしで安全にSQS stack差分をレビューできるようにする。

#### 対象

- `infra/aws/cloudformation/github-oidc-deployment-role-stack.json`
- Existing GitHub OIDC provider ARN parameter
- Exact staging GitHub OIDC subject parameter
- OIDC `aud=sts.amazonaws.com` / `sub`完全一致
- GitHub Actions deployment role
- CloudFormation execution role
- Target stack / generated roleへ限定したresource scope
- CloudFormation serviceへのscoped `iam:PassRole`
- `.github/workflows/deploy-sqs-staging-change-set.yml`
- `workflow_dispatch` / main / GitHub Environment `staging`
- `aws-actions/configure-aws-credentials@v6`
- `validate-template` / CREATE・UPDATE change set / describe summary
- Change set no-change処理
- Account ID masking
- Static template / workflow validator
- Security regression unit test
- `pnpm infra:validate`統合
- Staging OIDC bootstrap / change set review runbook
- Current-status / active-issues / logs / ai-prompts / handoff / Notion

#### 非対象

- 実AWS OIDC provider / bootstrap role stack deploy
- 実AWS SQS stack create / update / delete
- Change set execute
- Production environment / transport切替
- ECS / Lambda / EC2 resource
- ECS task definitionへのproducer / consumer role関連付け
- VPC endpoint / network path
- Customer managed KMS key / key policy
- DLQ replay / purge API・UI
- Queue metrics / dashboard / alert
- Worker application retry producerのSQS切替
- Outbox claim / lease
- Runner / hidden tests / auth / admin / learner UI変更
- DB schema / migration / seed変更

#### 完了条件

- `GitHubOidcProviderArn` / `GitHubOidcSubject`に既定値がない。
- Subject patternはstaging Environmentの完全一致形式だけを許可しwildcardを拒否する。
- Trust policyは`StringEquals`でaud / subを完全一致させる。
- Deployment roleとCloudFormation execution roleを分離する。
- Deployment roleはValidateTemplate / CreateChangeSet / read / scoped PassRoleだけを持つ。
- Deployment roleにExecuteChangeSet / CreateStack / UpdateStack / DeleteStackがない。
- `iam:PassRole`は対象execution roleと`cloudformation.amazonaws.com`だけに限定する。
- Execution roleのSQS / IAM resourceがstaging target stack範囲に限定される。
- Workflowは`workflow_dispatch`専用でmain以外を拒否する。
- WorkflowはGitHub Environment `staging`とOIDCを使用する。
- WorkflowはAWS access key secretを参照しない。
- Workflowはchange setを作成・要約するがexecuteしない。
- 通常PR CIからAWS APIを呼び出さない。
- Validatorがwildcard subject、trust緩和、権限拡大、direct execute、長期credential参照を拒否する。
- Docs validation / frozen install / lint / typecheck / unit / integration / schema validation / infra validation / buildが成功する。

#### 現在の確認結果

- GitHub Issue #127: Created
- Linear Issue: 無料Issue上限により作成失敗
- Notion page: Created
- OIDC deployment template: Added
- Review-only workflow: Added
- Static validator: Added
- Security regression unit test: 7 / 7 success（ローカル）
- `infra:validate` integration: Added
- Runbook / log / prompt / handoff: Added
- PR CI: 未確認
- 実AWS validation / change set: 未実施

## Recently Completed

### #125 / PR #126（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-30（日本時間）
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/125`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/126`
- 反映内容: SQS source queue、DLQ、RedrivePolicy、TLS deny、producer / consumer最小IAM role、static validator、runbookをCloudFormation IaCとして整備した。

### #123 / PR #124（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
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

1. ECS task definitionへのproducer / consumer role関連付けとruntime environment注入（P2）
2. Worker application retry producerのqueue runtime統合（P2）
3. DLQ replay / purge運用（P2）
4. Queue / outbox metrics backend・dashboard・alert（P2）
5. Outbox claim / lease（P2）
6. Durable application retry scheduling（P2）

## Branch Cleanup

- PR #124のhead branch `feat/sqs-consumer-poc` は削除済み。
- PR #126のhead branch `feat/sqs-cloudformation-infra` は削除確認対象。
- Issue #127のhead branchは `feat/staging-oidc-change-set`。
- Issue #127 merge後にhead branchを削除する。
