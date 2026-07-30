# Issue #127 GitHub OIDC staging change set handoff

日付: 2026-07-30

## 状態

- GitHub Issue: #127
- Branch: `feat/staging-oidc-change-set`
- Notion: `ai-code-dojo Issue #127 GitHub OIDC staging change set`
- Linear: 無料Issue上限のため登録不可
- 実AWS適用: 未実施
- Production transport: HTTP

## 実装済み

- OIDC deployment / CloudFormation execution role bootstrap template
- Review-only staging change set workflow
- OIDC trust / IAM / workflow static validator
- Security regression unit test 7件
- `infra:validate`統合
- Runbook / log / prompt / handoff

## 次の確認

1. PR CIを全件通す。
2. Static validatorの権限allowlistがCloudFormation templateと一致するかレビューする。
3. GitHub Environment `staging`のmain branch protectionを確認する。
4. 実AWS検証は別承認で行い、結果だけを機微情報なしで記録する。
5. Merge後にIssue #127とNotionをCompletedへ更新する。
6. Head branchを削除する。

## 実AWSで要確認

- Repositoryの実OIDC subject形式
- Existing OIDC provider ARN
- SCP / permission boundary
- CloudFormation execution roleが必要なSQS / IAM action
- Stack名・queue名衝突
- Change set warning
- GitHub-hosted runnerとconfigure-aws-credentials v6互換性

## 対象外の次候補

1. ECS task definitionへのproducer / consumer role関連付けとruntime env注入
2. Worker application retry producerのqueue runtime統合
3. DLQ replay / purge
4. Queue / outbox metrics・dashboard・alert
