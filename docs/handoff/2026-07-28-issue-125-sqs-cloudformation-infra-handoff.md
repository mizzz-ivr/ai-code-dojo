# Issue #125 SQS CloudFormation infrastructure handoff

## Summary

SQS source queue、DLQ、RedrivePolicy、TLS deny、producer / consumer最小IAM roleをCloudFormation JSONで追加した。通常CIはAWS credentialsを使わずstatic validationを実行し、実AWS validation / change set / executeはrunbookへ分離する。

## Current State

- Issue: #125
- PR: #126
- Branch: `feat/sqs-cloudformation-infra`
- PR状態: Ready for review
- PR mergeable: true
- Production transport: HTTPのまま
- 実AWS deploy: 未実施
- Notion: `https://app.notion.com/p/3ac7322f39fa81f48996e91be4913479`
- Linear: workspaceの無料Issue上限により新規登録不可

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

Ready移行前のfinal code / docs head:

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit: Success
- Integration: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success

Integrationはdocs更新後の初回実行で一時失敗したが、failed job再実行で成功した。

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

## Management Boundary

- GitHub Issue #125とPR #126を実装・レビュー状態の正本とする。
- Repository canonical docsをアーキテクチャ・運用状態の正本とする。
- Notionへレビュー用の要約を同期済み。
- Linearは無料Issue上限により登録できないため、上限解消までは同期対象外とする。

## Risks

- 実AWS accountのSCP、quota、permission boundary、queue名衝突は未検証。
- ECS task roleへの関連付けresourceは未実装。
- Customer managed KMS keyは未対応。
- Retained queueのinventory / cleanup運用が必要。
- Metrics / alarm / DLQ replay / purgeは未実装。
- Production transportはHTTPのまま。

## Remaining Tasks

1. 最新管理同期headのCIを確認する。
2. Issue #125へ実装・CI・Notion・Linear制約をコメントする。
3. PRレビュー後にmergeする。
4. Merge後にIssue close、docs完了同期、branch cleanupを行う。

## Next Recommended Issue

限定環境のdeployment wiringとして、GitHub OIDC deployment role、ECS task definition / task role関連付け、change set workflow、SQS runtime environment注入を別Issueで扱う。
