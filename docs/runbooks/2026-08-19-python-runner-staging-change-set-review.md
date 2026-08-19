# Python Runner staging change set review runbook

作成日: 2026-08-19

## このrunbookの範囲

validated Python Runner image release artifactからreview-only CloudFormation change setを作るための準備・確認手順を定義する。

このrunbookは`ExecuteChangeSet`を許可しない。Actual AWS bootstrap / image publish / change set作成・実行は、それぞれ明示承認後に行う。

## merge直後の状態

PR #154をmergeしても次は自動作成されない。

- review role
- CloudFormation execution role
- GitHub Environment
- ECR image
- CloudFormation change set
- staging ECS/EC2 Runner

Python Public submissionもOFFのまま。

## Actual利用前の必須準備

### 1. CloudFormation execution roleを別PRでレビューする

`python-runner-staging-stack.json`が必要とするAWS service actionを棚卸しし、target resource / naming / tag conditionを可能な範囲で限定する。

review roleへ渡す`CloudFormationExecutionRoleArn`はこのレビュー済みroleだけにする。

### 2. review role stackをレビューする

`infra/aws/cloudformation/python-runner-change-set-review-role-stack.json`について次を確認する。

- OIDC subjectが`staging-python-runner-review`だけ
- target stack名が`ai-code-dojo-staging-python-runner`だけ
- CreateChangeSetのRoleArn conditionがreview済みexecution roleを指す
- ExecuteChangeSetがない
- direct stack mutation actionがない

Actual applyは明示承認後に行う。

### 3. GitHub Environmentを準備する

Environment: `staging-python-runner-review`

推奨保護:

- required reviewer
- deployment branchを`main`のみに限定

Variables:

- `AWS_STAGING_REGION`
- `AWS_STAGING_ACCOUNT_ID`
- `AWS_STAGING_PYTHON_RUNNER_REVIEW_ROLE_ARN`
- `AWS_STAGING_PYTHON_RUNNER_CFN_EXECUTION_ROLE_ARN`
- `AWS_STAGING_PYTHON_RUNNER_STACK_NAME=ai-code-dojo-staging-python-runner`
- `AWS_STAGING_VPC_ID`
- `AWS_STAGING_PRIVATE_SUBNET_IDS`
- `AWS_STAGING_PRIVATE_HOSTED_ZONE_ID`
- `AWS_STAGING_PYTHON_RUNNER_DNS_NAME`
- `AWS_STAGING_PYTHON_RUNNER_CERTIFICATE_ARN`
- `AWS_STAGING_PYTHON_RUNNER_INSTANCE_TYPE=t3.small`を初期推奨

AWS access key secretは設定しない。

## Release artifact前提

先に`publish-python-runner-staging-image`をmainから明示承認付きで成功させ、release workflow run IDを取得する。

review workflowはそのrunについて次を自動検証する。

- manual workflow
- main
- success
- exact artifact name
- artifact未期限
- manifest + checksumだけ
- checksum一致
- manifest schema
- sourceCommitとrun head SHA一致
- sourceCommitがcurrent main ancestor

## AWS topologyの手動 / read-only preflight

change set execute前に必ず確認する。

### Network

- VPC IDがstaging対象VPCである。
- private subnetが2件以上ある。
- subnetが少なくとも2 AZへ分散している。
- public IP自動付与が無効。
- ECR / Secrets Manager / CloudWatch Logs / sandbox image pullに必要なHTTPS egress経路がある。

### DNS / TLS

- private hosted zoneが対象VPCへassociation済み。
- RunnerDnsNameがprivate hosted zone配下。
- ACM certificateのSAN/CNがRunnerDnsNameをcoverする。
- certificateが対象region / accountにあり、利用可能状態。

### Image

- release manifestのrepositoryが`ai-code-dojo-staging-python-runner`。
- digest URIが`repository@sha256:...`。
- selected releaseが意図したsource commitである。

## review-only workflowの使い方

Workflow: `review-python-runner-staging-change-set`

入力:

- `release_run_id`: 成功済みimage publish workflow run ID
- `confirm_review`: `CREATE_PYTHON_RUNNER_STAGING_CHANGE_SET`

workflowはAWS credential取得前にrelease identityを検証する。

その後、OIDC review roleで:

1. CloudFormation template validation
2. target stackのCREATE / UPDATE判定
3. deterministic parametersによるCreateChangeSet
4. change set completion wait
5. summary出力

までを行う。

## レビュー観点

summaryで最低限次を確認する。

- source commit / image digestが意図したreleaseか
- Replacementが発生しないか
- Security Group ingress / egressが拡大していないか
- public IP / internet-facing ALBが導入されていないか
- IAM role / policyが想定以上に増えていないか
- ECS DesiredCount / ASG capacityが1を超えていないか
- Secrets Manager secretがplaintext化されていないか
- Docker socket bindがdedicated Runner host外へ拡散していないか

## Change set実行

このworkflowでは実行しない。

`ExecuteChangeSet`は別の明示承認付き手順でのみ行う。実行前に:

- change setが作成後に変更されていないこと
- execution roleがreview済みであること
- Replacement / IAM / network / cost差分を承認したこと
- rollback手順を確認したこと

を確認する。

## 失敗時

### release artifact validation failure

AWS credential取得前に停止する。別runや別artifactへ手動差し替えせず、publish workflow runとartifactを確認する。

### no changes

正常扱い。change setをexecuteしない。

### CreateChangeSet failure

CloudFormation Console / read-only Describe結果で原因を確認する。workflowへ追加権限を即座に付けず、必要権限か設定誤りかを切り分ける。

### expired artifact

同じimmutable tagを再pushしない。既存ECR digestをread-onlyで確認し、PR #152 runbookのmanifest復旧手順を使うか、新しいsource commit releaseとして再publishする。

## 完了条件

Actual staging deployへ進む前に:

- execution roleレビュー完了
- release artifact identity確認完了
- topology preflight完了
- change set差分レビュー完了
- rollback / cost / secret rotation方針確認
- 明示承認取得

を満たす。
