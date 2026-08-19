# Python Runner staging change set review設計

最終更新: 2026-08-19

## 目的

PR #152で生成可能になったimmutable Python Runner image release manifestを、任意image URIの手入力なしで`python-runner-staging-stack.json`へ接続し、CloudFormation change setをreview-onlyで生成する。

この設計はActual deployを自動化するものではない。`ExecuteChangeSet`は明示的に非対象とし、Python Public submissionはOFFを維持する。

## Trust boundary

```text
successful manual publish workflow on main
  -> exact release artifact identity
  -> artifact file-set + SHA-256 checksum
  -> release manifest schema
  -> publish run head SHA == manifest sourceCommit
  -> sourceCommit is ancestor of current main
  -> deterministic staging parameter bundle
  -> GitHub OIDC review role
  -> CloudFormation CreateChangeSet
  -> human review
  -> STOP (no ExecuteChangeSet)
```

## Release artifact identity

workflow入力は`release_run_id`だけを受け取る。image URI / digest / tagを直接入力できない。

AWS credential取得前にGitHub APIでselected runを確認する。

- workflow name: `publish-python-runner-staging-image`
- event: `workflow_dispatch`
- head branch: `main`
- conclusion: `success`
- head SHA: full lowercase 40 hex

artifact名は`python-runner-image-release-<head_sha>`としてrun identityから導出する。

そのrunに同名・未期限artifactがちょうど1つあることを要求し、downloadもexact nameで行う。

artifact内は次の2ファイルだけを許可する。

- `python-runner-image-release.json`
- `python-runner-image-release.json.sha256`

manifest checksum、schema、`sourceCommit == publish run head_sha`、current main ancestryを検証する。

古いmain commit由来releaseはrollback候補として許可する。一方、PR branchだけに存在するcommitやselected publish runと異なるmanifestは拒否する。

## Parameter boundary

CloudFormationへ渡すparameterは次の8個だけ。

1. `EnvironmentName=staging`
2. `VpcId`
3. `PrivateSubnetIds`
4. `PrivateHostedZoneId`
5. `RunnerDnsName`
6. `CertificateArn`
7. `RunnerServiceImageUri`
8. `RunnerInstanceType`

`RunnerServiceImageUri`はvalidated release manifestの`repository@sha256:digest`からのみ生成する。

Environment variables側では次を検証する。

- AWS account: 12 digits
- region format
- VPC / subnet / hosted zone ID format
- subnet: 2件以上・重複なし
- DNS: lowercase FQDN
- ACM certificate ARN: account / region一致
- ECR repository URI: account / region / repository名一致
- instance type: `t3.small`または`t3.medium`

## Review role

GitHub Environmentは`staging-python-runner-review`を使用する。

review roleに許可するのは次だけ。

- `cloudformation:ValidateTemplate`
- target stack限定`cloudformation:CreateChangeSet`
- target stackの`DescribeStacks` / `GetTemplate` / `ListChangeSets`
- generated change setの`DescribeChangeSet`
- separately reviewed CloudFormation execution roleへの`iam:PassRole`

`CreateChangeSet`は次のconditionへ固定する。

- `cloudformation:RoleArn` = bootstrap時に固定したexecution role ARN
- `cloudformation:ChangeSetName` = `ai-code-dojo-python-runner-staging-*`

review roleには`ExecuteChangeSet`、直接`CreateStack` / `UpdateStack` / `DeleteStack`、target ECS/EC2/IAM等の直接変更権限を与えない。

## CloudFormation execution role

今回のIssueでは最終least-privilege execution roleを定義しない。

理由は、staging stackがEC2 / ECS / ELBv2 / Auto Scaling / IAM / Secrets Manager / Logs / Route53 / Security Group等を含み、execution roleの権限レビュー自体が独立した高リスク変更だからである。

review workflowは`AWS_STAGING_PYTHON_RUNNER_CFN_EXECUTION_ROLE_ARN`を要求するが、Actual利用前に別PRでそのroleを明示的に定義・検証する。

## Change set review output

workflow summaryには次を表示する。

- stack name
- CREATE / UPDATE
- release workflow run ID
- release source commit
- image digest
- change set name
- `Execute: 未実施`
- `Python Public gate: OFF`
- Action / LogicalResourceId / ResourceType / Replacement

Replacementが`True`またはConditionalを含む場合、実行可否を別レビューする。

## 未検証の実AWS topology

Repository内validatorだけでは次を証明できない。

- subnetが実際にprivateであること
- subnetが2 AZ以上に分散していること
- private hosted zoneが対象VPCへassociation済みであること
- ACM SAN/CNがRunnerDnsNameをcoverすること
- routing / NAT / VPC endpointが必要なoutbound dependencyを満たすこと

Actual change set execute前にread-only AWS preflightまたは手動確認を行う。これをreview roleへ混ぜる場合は、権限拡大を別差分としてレビューする。

## 維持する境界

- API processでsubmission codeを実行しない。
- WorkerへDocker socketを公開しない。
- hidden casesをPython sandbox filesystemへmountしない。
- mutable tagをstaging runtimeへ渡さない。
- arbitrary image URI / digest入力を許可しない。
- AWS long-lived credentialを使用しない。
- change setは作成・レビューだけ。実行しない。
- Python Public submissionはstaging adversarial gate完了までOFF。
