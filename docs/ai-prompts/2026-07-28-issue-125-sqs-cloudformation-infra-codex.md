# Issue #125 SQS CloudFormation infrastructure 実装prompt

あなたは `mizzz-ivr/ai-code-dojo` のシニアPM・テックリード・ソフトウェアアーキテクト・レビュアーです。

## 最優先ルール

1. `docs/ai-protocol/PROMPT.txt`を読む。
2. README / project-overview / current-status / active-issues / system-overviewを正本とする。
3. APIで提出コードを直接実行しない。
4. Hidden testsをlearnerへ返さない。
5. Challengeはversion追加方式とする。
6. Issue #125以外の機能変更を混在させない。
7. PR、commit、Issue、docsは日本語とする。
8. Branch名へ`codex`を含めない。

## Current state

- Issue: #125
- PR: #126
- Branch: `feat/sqs-cloudformation-infra`
- Template: `infra/aws/cloudformation/sqs-queue-stack.json`
- Validation: `pnpm infra:validate`
- Production transport: HTTPのまま

## 目的

SQS source queue、DLQ、RedrivePolicy、TLS deny、producer / consumer最小IAM roleをCloudFormationで再現可能に管理する。

## 必須境界

- Standard / FIFOを同一templateで選択可能にする。
- Source / DLQのtypeを一致させる。
- SQS-managed SSEを有効にする。
- Source retention 4日、DLQ retention 14日とする。
- Long polling 20秒、visibility timeout 90秒とする。
- `MaxReceiveCount`既定5とする。
- DLQは`RedriveAllowPolicy=byQueue`とし、source queueだけを許可する。
- TLSでないaccessをsource / DLQ双方で拒否する。
- Producer roleはsourceへの`SendMessage`だけとする。
- Consumer roleはsourceへの`ReceiveMessage` / `DeleteMessage` / `ChangeMessageVisibility`だけとする。
- RoleNameを固定しない。
- Queue削除・置換ではRetainする。
- Standard / FIFO直接変更を同一stackで推奨しない。
- HTTP producer / consumerをrollback先として維持する。
- CIから実AWS resourceを作成しない。

## 非対象

- 実AWS deploy
- Production transport切替
- GitHub OIDC deployment role
- ECS / Lambda / EC2 / VPC
- Customer managed KMS key
- DLQ replay / purge
- Metrics / alert
- Worker application retry producer切替
- Outbox claim / lease
- Runner / hidden tests / auth / UI

## レビュー観点

- CloudFormation resource間に循環依存がないか。
- FIFO source / DLQ双方の`.fifo` suffixが正しいか。
- RedrivePolicyとRedriveAllowPolicyが対応しているか。
- IAM action・resourceが完全に最小化されているか。
- Queue policyがTLS deny以外を不用意に許可していないか。
- Retain後のcleanupがrunbookに明記されているか。
- Stack outputsがruntime設定に利用可能か。
- Static validatorがsecurity regressionを検知できるか。
- Build artifactにinfraが含まれるか。
- 実AWS deployをPR CIで実行していないか。

## 完了条件

- docs validation
- frozen install
- lint
- typecheck
- unit
- integration
- schema validation
- infra validation
- build

上記をfinal headで成功させ、PR本文に目的、背景、変更内容、影響範囲、テスト、rollout、rollback、レビュー観点、未対応事項を記載してReady for reviewへ移す。
