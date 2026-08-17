# AWS CloudFormation infrastructure

## 構成

- `sqs-queue-stack.json`: Source queue、DLQ、RedrivePolicy、TLS deny、producer / consumer workload role
- `github-oidc-deployment-role-stack.json`: GitHub Actions OIDC deployment role
- `python-runner-staging-stack.json`: Python Remote Runner向けreview-only staging基盤。専用ECS/EC2 host、internal ALB、Secrets Manager、最小Security Groupを定義

## Local validation

```bash
pnpm infra:validate
```

このvalidationはAWS credentialsを使用せず、Repositoryで定めたsecurity・operations契約を確認する。`python-runner-staging-stack.json`については、Fargate化、public ingress、SSH、public IP、capacity拡大、plaintext secret、privileged modeなどをfail-closedで拒否する。

## AWS validation

```bash
aws cloudformation validate-template \
  --template-body file://infra/aws/cloudformation/<template>.json \
  --region <region>
```

IAM resourceを含むtemplateのchange set / deployには`CAPABILITY_IAM`が必要となる。

## Python Runner staging stack

`python-runner-staging-stack.json`は**review-only**であり、このRepositoryのCIから実AWS resourceを作成しない。

現行`apps/python-runner`はhost Docker daemonへ`docker run`を依頼するため、`sourcePath` bind mountを利用できないFargateへ単純配置しない。stagingでは専用ECS/EC2 hostを1台だけ使用し、Docker socketへのアクセスをそのhost上のRunner control planeだけへ閉じ込める。

主なparameter:

| Parameter | Default | Description |
|---|---|---|
| `EnvironmentName` | `staging` | tag / resource識別子 |
| `VpcId` | required | 既存staging VPC |
| `PrivateSubnetIds` | required | internal ALB / Runner host用private subnet。ALB用に2 AZ以上を前提とする |
| `PrivateHostedZoneId` | required | Runner private DNS用Route53 private hosted zone |
| `RunnerDnsName` | required | `PYTHON_REMOTE_RUNNER_URL`に使用するprivate FQDN |
| `CertificateArn` | required | `RunnerDnsName`をカバーする同一regionのACM certificate |
| `RunnerServiceImageUri` | required | private ECRのsha256 digest固定Runner service image |
| `RunnerInstanceType` | `t3.small` | staging専用host。`t3.small` / `t3.medium`のみ |

主なoutput:

- `RunnerUrl`
- `RunnerSharedSecretArn`
- `RunnerClientSecurityGroupId`: staging Workerへ明示attachする専用client SG
- `RunnerAlbSecurityGroupId`
- `RunnerHostSecurityGroupId`
- ECS cluster / service / Auto Scaling group名

## Safety boundary

- CIから実resourceを作成しない。
- Actual AWS changeはchange setレビューとユーザーの明示承認を経る。
- Python Public allowlistはstaging adversarial test完了まで有効化しない。
- Runnerはpublic ALB / public IP / SSH keyを持たない。
- WorkerへDocker socketを公開しない。
- Docker socketはroot-equivalentであるため、Runner hostはco-tenantなしの専用hostとする。
- Runner control plane taskにapplication TaskRoleを与えない。
- HMAC secret値はCloudFormation output / Repositoryへ出さない。
- ASG / ECS serviceはstagingで1 host / 1 taskへ固定する。
- Runtime切替はresource作成とは別changeとして実施する。

詳細:

- SQS: `docs/runbooks/2026-07-28-sqs-cloudformation-infra-runbook.md`
- Python Runner staging: `docs/runbooks/2026-08-14-python-runner-staging-iac.md`
