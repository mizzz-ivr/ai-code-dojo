# Issue #125 SQS CloudFormation infrastructure handoff

## Summary

SQS source queue、DLQ、RedrivePolicy、TLS deny、producer / consumer最小IAM roleをCloudFormation JSONで追加した。通常CIはAWS credentialsを使わずstatic validationを実行し、実AWS validation / change set / executeはrunbookへ分離する。

## Current State

- Issue: #125
- PR: #126
- Branch: `feat/sqs-cloudformation-infra`
- PR状態: Draft
- Production transport: HTTPのまま
- 実AWS deploy: 未実施

## Main Files

- `infra/aws/cloudformation/sqs-queue-stack.json`
- `infra/aws/cloudformation/README.md`
- `scripts/lib/sqs-cloudformation-validator.mjs`
- `scripts/validate-sqs-cloudformation.mjs`
- `tests/unit/sqs-cloudformation-validator.test.mjs`
- `docs/runbooks/2026-07-28-sqs-cloudformation-infra-runbook.md`

## Template Resources

- `SourceQueue`
- `DeadLetterQueue`
- `QueueTlsPolicy`
- `ProducerRole`
- `ConsumerRole`

## Parameters

- `EnvironmentName=dev`
- `QueueType=standard|fifo`
- `MaxReceiveCount=5`
- `WorkloadServicePrincipal=ecs-tasks.amazonaws.com`

## Queue Contract

Source queue:

- Retention: 4日
- Long polling: 20秒
- Visibility: 90秒
- SQS-managed SSE
- RedrivePolicy → DLQ

DLQ:

- Retention: 14日
- SQS-managed SSE
- `RedriveAllowPolicy=byQueue`
- Source queue ARNだけを許可

Source / DLQ:

- Standard / FIFO type一致
- FIFO名は`.fifo`
- TLSでないaccessを拒否
- 削除・置換時はRetain

## IAM Contract

Producer role:

- Trust principalはparameter
- Source queueへの`sqs:SendMessage`だけ

Consumer role:

- Trust principalはparameter
- Source queueへの以下だけ
  - `sqs:ReceiveMessage`
  - `sqs:DeleteMessage`
  - `sqs:ChangeMessageVisibility`

付与しないもの:

- DLQ read
- PurgeQueue
- Queue作成・削除・属性変更
- Wildcard resource
- Managed policy
- 固定RoleName

## Static Validation

```bash
pnpm infra:validate
```

検査対象:

- JSON構文
- Resource / parameter / condition
- Standard / FIFO命名
- SSE / retention / polling / visibility
- Redrive / RedriveAllowPolicy
- 循環依存回避
- TLS deny
- IAM action / resource完全一致
- Outputs
- Account ID / access key混入

## CI

app-qualityへ`infra-validation` jobを追加し、buildはinfra-validation成功を必須とする。

Initial PR head:

- Docs validation: Success
- Lint: Success
- Typecheck: Success
- Unit: Success
- Integration: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success

## Deployment Boundary

- PR CIからAWS resourceを作成しない。
- AWS CLI `validate-template`を手動実行する。
- Create / Updateはchange setを作成して差分レビューする。
- 承認後だけexecuteする。
- IAM resourceのため`CAPABILITY_IAM`を指定する。
- Runtime切替はresource deployと別changeにする。

## Rollback Boundary

- API / WorkerをHTTP transportへ戻す。
- SQS messageは削除せず隔離する。
- DB lease / stale scanner / attempt fencing / completion guardを維持する。
- Standard / FIFO変更は別stackで段階切替する。
- Stack削除後もsource / DLQはRetainされる。
- Queue削除はdepth、DLQ、参照、保存要件、明示承認を確認後に行う。

## Risks

- 実AWS accountのSCP、quota、permission boundary、queue名衝突は未検証。
- ECS task roleへの関連付けresourceは未実装。
- Customer managed KMS keyは未対応。
- Retained queueのinventory / cleanup運用が必要。
- Metrics / alarm / DLQ replay / purgeは未実装。
- Production transportはHTTPのまま。

## Remaining Tasks

1. Canonical docs更新
2. Final head CI確認
3. PR本文完成
4. PRをReady for reviewへ変更
5. Issueコメント
6. Notion / Linear同期
7. Merge後branch cleanup

## Next Recommended Issue

限定環境のdeployment wiringとして、GitHub OIDC deployment role、ECS task definition / task role関連付け、change set workflow、SQS runtime environment注入を別Issueで扱う。
