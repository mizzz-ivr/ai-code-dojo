# GitHub OIDC staging SQS change set runbook

最終更新: 2026-07-30（Issue #127）

## 目的

GitHub Actionsから長期AWS access keyを使用せず、staging SQS stackのCloudFormation change setを作成・レビューする。

このrunbookはbootstrapとreviewまでを扱い、change setのexecute、production切替、ECS taskへのrole関連付けは扱わない。

## 前提

- GitHub Issue #127の変更がmainへmerge済みである。
- AWS accountに`token.actions.githubusercontent.com`のIAM OIDC providerが存在する。
- Bootstrapを実行する管理者はIAM role作成とCloudFormation stack管理権限を持つ。
- GitHub Environment `staging`を作成し、deployment branch / tag ruleでmainだけを許可する。
- Repositoryで実際に発行されるOIDC subject形式を確認する。
  - 従来形式: `repo:mizzz-ivr/ai-code-dojo:environment:staging`
  - Immutable形式: `repo:mizzz-ivr@OWNER_ID/ai-code-dojo@REPOSITORY_ID:environment:staging`
- Subjectは完全一致で渡し、`*`や`?`を使用しない。

## セキュリティ境界

- OIDC trustは`aud=sts.amazonaws.com`とstaging subjectの`StringEquals`だけを許可する。
- GitHub Actions deployment roleはtemplate validation、change set作成・参照、対象execution roleのPassRoleだけを持つ。
- GitHub Actions deployment roleは`ExecuteChangeSet`、`CreateStack`、`UpdateStack`、`DeleteStack`を持たない。
- CloudFormation execution roleはstaging grading queueと対象stackが生成するworkload roleだけを操作する。
- GitHub workflowは`workflow_dispatch`専用でmain以外を拒否する。
- GitHub workflowはchange setを実行しない。
- QueueUrl、AWS account ID、credentials、ReceiptHandle、raw attempt key、code、testsをGitHub Summaryへ出さない。

## 1. Static validation

```bash
pnpm install --frozen-lockfile
pnpm infra:validate
pnpm test:unit
```

通常PR CIはここまでとし、AWS APIを呼び出さない。

## 2. OIDC subjectを確定する

GitHub repository / organizationのOIDC subject設定を確認し、staging Environmentを参照するjobが発行するsubjectを確定する。

Repository作成時期やimmutable subjectへのopt-in・rename・transferにより形式が変わるため、名前だけで推測してbootstrapしない。

## 3. Bootstrap stackをvalidateする

```bash
aws cloudformation validate-template \
  --template-body file://infra/aws/cloudformation/github-oidc-deployment-role-stack.json
```

## 4. Bootstrap change setを作成する

以下はplaceholderを実値へ置換する。実値をIssue、PR、docs、logsへ貼り付けない。

```bash
aws cloudformation create-change-set \
  --stack-name ai-code-dojo-staging-github-oidc \
  --change-set-name bootstrap-review \
  --change-set-type CREATE \
  --template-body file://infra/aws/cloudformation/github-oidc-deployment-role-stack.json \
  --parameters \
    ParameterKey=GitHubOidcProviderArn,ParameterValue='<OIDC_PROVIDER_ARN>' \
    ParameterKey=GitHubOidcSubject,ParameterValue='<EXACT_STAGING_SUBJECT>' \
    ParameterKey=TargetStackName,ParameterValue=ai-code-dojo-staging-sqs \
    ParameterKey=EnvironmentName,ParameterValue=staging \
  --capabilities CAPABILITY_IAM
```

Change setで次を確認する。

- OIDC provider自体を新規作成しない。
- GitHub Actions deployment roleとCloudFormation execution roleの2 roleだけを作成する。
- RoleNameが固定されていない。
- Trustがaud / sub完全一致になっている。
- Deployment roleにchange set execute / stack mutation権限がない。
- PassRoleがexecution roleとCloudFormationだけに限定されている。
- Execution roleのSQS / IAM resourceがstaging範囲に限定されている。

承認された場合だけ、管理者がbootstrap change setをexecuteする。GitHub workflowはbootstrapを実行しない。

## 5. GitHub Environmentを設定する

Environment名: `staging`

必須variables:

- `AWS_STAGING_REGION`
- `AWS_STAGING_DEPLOY_ROLE_ARN`
- `AWS_STAGING_CFN_EXECUTION_ROLE_ARN`
- `AWS_STAGING_SQS_STACK_NAME=ai-code-dojo-staging-sqs`

必須protection:

- Deployment branches / tagsはmainのみ
- 利用可能なplanでrequired reviewerを設定
- Environment variablesへcredentialsやQueueUrlを保存しない

## 6. Review-only workflowを実行する

GitHub Actionsの`deploy-sqs-staging-change-set`をmainから手動実行し、次を選択する。

- `queue_type`: `standard`または`fifo`
- `max_receive_count`: 1〜999

Workflowは次を行う。

1. Environment variablesを検証する。
2. OIDCでdeployment roleを引き受ける。
3. SQS templateをvalidateする。
4. 対象stackの存在有無からCREATE / UPDATEを選ぶ。
5. CloudFormation execution roleを指定してchange setを作る。
6. Resource changeだけをJob Summaryへ表示する。
7. Executeせず終了する。

## 7. Change set review

最低限、次を確認する。

- 予期しないresource追加・削除がない。
- Source / DLQのreplacementがない。
- Standard / FIFO変更によるqueue replacementがない。
- IAM roleの権限拡大がない。
- Queue retention、visibility、redrive、SSE、TLS denyが維持される。
- CloudFormation warningやquota警告がない。
- Runtime transport切替が混在していない。

## 8. No-change / failure

- No-changeは成功扱いとし、execute対象はない。
- Change set作成失敗時はGitHubへraw ARN / account ID / QueueUrlを転記しない。
- AWS Console / CloudTrailで権限、SCP、permission boundary、quota、stack名衝突を確認する。
- OIDC失敗時はsubject、Environment protection、aud、provider ARNを確認する。
- IAM policyをwildcardへ広げて回避しない。

## 9. Cleanup

Review不要になったchange setはAWS Consoleまたは権限を持つ管理者手順で削除する。

このworkflow自身にはchange set削除・execute・stack削除権限を持たせない。

## Rollback

- GitHub workflowを実行しない。
- `API_QUEUE_TRANSPORT=http`を維持する。
- `WORKER_QUEUE_CONSUMER=http`を維持する。
- Bootstrap roleを削除する場合は、対象stack・change set・CloudTrail参照を確認し、管理者承認後に行う。
- SQS stack削除時もRetainされたqueueを自動削除しない。

## 未対応

- Bootstrap stackの実AWS適用
- SQS stack change setのexecute
- Production Environment
- ECS task definitionへのproducer / consumer role関連付け
- VPC endpoint / KMS
- DLQ replay / purge
- Queue / outbox metrics・dashboard・alert
