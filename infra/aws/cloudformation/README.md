# SQS CloudFormation infrastructure

## 構成

- `sqs-queue-stack.json`: Source queue、DLQ、RedrivePolicy、TLS deny、producer / consumer workload role

## Local validation

```bash
pnpm infra:validate
```

このvalidationはAWS credentialsを使用せず、Repositoryで定めたsecurity・operations契約を確認する。

## AWS validation

```bash
aws cloudformation validate-template \
  --template-body file://infra/aws/cloudformation/sqs-queue-stack.json \
  --region <region>
```

IAM resourceを含むため、change set / deploy時は`CAPABILITY_IAM`が必要となる。

## Parameters

| Parameter | Default | Description |
|---|---|---|
| `EnvironmentName` | `dev` | Queue名・tagに使用する環境識別子 |
| `QueueType` | `standard` | `standard`または`fifo` |
| `MaxReceiveCount` | `5` | DLQへ移す前の最大受信回数 |
| `WorkloadServicePrincipal` | `ecs-tasks.amazonaws.com` | Producer / consumer roleのtrust principal |

## Outputs

- Source / DLQ QueueUrl・QueueArn
- Producer / consumer RoleArn
- API / Workerの非secret runtime設定例

## Safety boundary

- CIから実resourceを作成しない。
- Source / DLQは削除・置換時に`Retain`する。
- Standard / FIFOを同一stackで直接切り替えない。
- QueueUrl、account ID、credentialをRepositoryへ保存しない。
- Runtime切替はresource作成とは別changeとして実施する。

詳細は `docs/runbooks/2026-07-28-sqs-cloudformation-infra-runbook.md` を参照する。
