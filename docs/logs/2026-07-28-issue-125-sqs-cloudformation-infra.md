# Issue #125 SQS CloudFormation infrastructure 作業ログ

## Summary

Issue #123 / PR #124で完成したSQS producer / consumer runtimeに対応するAWS resource定義として、source queue、DLQ、redrive、TLS deny、producer / consumer最小IAM roleをCloudFormationで追加した。

## Current Issue / PR

- Issue: #125
- PR: #126
- Branch: `feat/sqs-cloudformation-infra`
- PR状態: Ready for review
- Production transport: HTTPのまま
- 実AWS deploy: 未実施
- Notion: `https://app.notion.com/p/3ac7322f39fa81f48996e91be4913479`
- Linear: workspaceの無料Issue上限により新規登録不可

## Implemented

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
- Producer role: `sqs:SendMessage`
- Consumer role: `sqs:ReceiveMessage` / `sqs:DeleteMessage` / `sqs:ChangeMessageVisibility`
- Runtime設定用stack outputs
- `DeletionPolicy=Retain` / `UpdateReplacePolicy=Retain`
- AWS credentials不要のstatic validator
- Validator改変検知unit test
- app-quality `infra-validation` job
- Build artifactへの`infra`追加
- Manual validate / change set / deploy / rollback runbook

## Technical Decisions

- Terraform / CDK依存を追加せず、AWS標準CloudFormation JSONを採用する。
- JSON形式によりNode.js標準`JSON.parse`でCI検証可能にする。
- CloudFormation `validate-template`はAWS認証が必要なため、通常PR CIではlocal static validatorを実行する。
- 実AWS validation・change set・executeはrunbookに分離する。
- DLQからsource queue ARNを決定的に組み立て、source→DLQとDLQ→sourceの循環依存を避ける。
- Workload trust principalはparameter化し、既定値をECS taskとする。
- RoleNameを固定せず、`CAPABILITY_IAM`でdeployする。
- Queue deletion / replacementではmessage消失を避けるためRetainする。
- Standard / FIFO変更はreplacementになるため、別stackによる段階切替とする。

## Security Review

- SQS-managed SSEをsource / DLQ双方で必須化した。
- `aws:SecureTransport=false`をqueue policyで拒否した。
- Producer / consumer roleを分離した。
- Queue resourceはsource ARNだけに限定した。
- Producerへconsumer / purge / queue管理権限を付与していない。
- Consumerへproducer / DLQ read / purge / queue管理権限を付与していない。
- Literal account ID、access key ID、QueueUrl実値をtemplateへ保存していない。
- Customer managed KMS keyは本Issueへ混在させていない。

## Validation

Ready移行前のfinal code / docs head:

- docs validation: Success
- frozen install: Success
- lint: Success
- typecheck: Success
- unit: Success
- integration: Success
- schema validation: Success
- infra validation: Success
- build: Success

Integration testはdocs更新後の初回実行で一時失敗したが、機能差分のない更新だったためfailed jobのみ再実行し、成功を確認した。

## Management Sync

- GitHub Issue #125を作成済み。
- GitHub PR #126をReady for reviewへ変更済み。
- PR本文へ目的、背景、変更内容、影響範囲、テスト、rollout、rollback、レビュー観点、未対応事項を記載済み。
- Notionへ設計、CI、deployment境界、rollback、リスクを同期済み。
- Linearは重複検索後に作成を試みたが、workspaceの無料Issue上限により登録できなかった。
- Linear復旧まではGitHub Issue / PR、Repository docs、Notionを管理正本とする。

## Risks

- 実AWS accountでの`validate-template` / change set / deployは未実施。
- Organization SCP、permission boundary、quota、queue名衝突はaccount上でのみ確認可能。
- Retained queueはstack削除後に残るため、明示cleanup管理が必要。
- Standard / FIFO切替でretained old queueが残る。
- Workload roleをECS taskへ関連付けるresourceは未作成。
- VPC endpoint、network path、metrics、alertは未実装。
- Runtime transportはHTTPのままで、自動切替しない。

## Remaining Tasks

- 最新管理同期headのCI確認
- Issue #125へ実装・CI・Notion・Linear制約をコメント
- PRレビューとmerge
- Merge後のIssue close、docs完了同期、branch cleanup

## Next Recommended Issues

1. 限定環境用ECS / deployment wiringとGitHub OIDC deployment role
2. Worker application retry producerのqueue runtime統合
3. DLQ replay / purge運用
4. Queue / outbox metrics・dashboard・alert
5. Outbox claim / lease
