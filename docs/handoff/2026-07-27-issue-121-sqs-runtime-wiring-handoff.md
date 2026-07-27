# Issue #121 SQS runtime wiring handoff

## Summary
AWS SDK for JavaScript v3を導入し、API起動時にHTTP / SQS queue transportを選択するruntime factoryを追加した。Legacy submissionとtransactional outboxは同じruntime enqueueを利用する。

## Current State
- Issue: #121
- PR: #122
- Branch: `feat/sqs-runtime-wiring`
- PR状態: Draft
- CI状態: コード・依存headでapp-quality成功、docs反映後のfinal head確認待ち

## Implemented
- `@aws-sdk/client-sqs` dependency
- pnpm frozen lockfile
- `apps/api/src/config/queue-transport-config.mjs`
- `apps/api/src/services/queue-runtime.mjs`
- API server runtime wiring
- Legacy / outbox共通enqueue
- SQS client一回生成・再利用
- Best-effort client destroy
- HTTP default / rollback behavior
- Config / runtime unit test
- Runtime経由SQS outbox component integration test
- Invalid startup configuration process integration test
- Producer IAM policy examples
- Canonical docs / runbook / logs / prompt / handoff

## Runtime Configuration

HTTP:

```text
API_QUEUE_TRANSPORT=http
```

SQS:

```text
API_QUEUE_TRANSPORT=sqs
API_QUEUE_OUTBOX_ENABLED=1
API_SQS_REGION=<region>
API_SQS_QUEUE_URL=https://sqs.<region>.amazonaws.com/<account-id>/<queue-name>
API_SQS_QUEUE_TYPE=standard|fifo
```

## Credentials Boundary
- `SQSClient({ region })`だけをapplicationから指定する。
- CredentialsはAWS SDK v3 default credential provider chainへ委譲する。
- Static access key設定を追加していない。
- Credentials値やprovider sourceをevent / responseへ出さない。
- Credential / IAM不足はsend時に失敗し、outboxはpendingを維持する。

## IAM
通常producer:
- `docs/security/iam/sqs-producer-policy.json`
- 対象queueへの`sqs:SendMessage`のみ

Customer managed KMS key:
- `docs/security/iam/sqs-producer-customer-managed-kms-policy.json`
- `sqs:SendMessage`
- `kms:Decrypt`
- `kms:GenerateDataKey`

Producer roleへReceiveMessage / DeleteMessage / PurgeQueue / queue管理権限を付与しない。

## Correctness Boundary
- Queue runtimeはdelivery availabilityを担う。
- Transactional outboxはpublish intent durabilityを担う。
- Worker conditional claim / attempt fencing / processing lease / completion guardが採点correctnessを担う。
- Standard SQSのduplicate deliveryやFIFO deduplicationへcorrectnessを依存しない。
- Transport publishでgrading attempt / attempt keyを変更しない。

## Production State
- 実AWS SQS queue / IAM role / KMS / network pathは未作成・未検証。
- Production deploymentは変更していない。
- HTTPが既定transportのまま。
- SQS consumerは未実装。
- ProducerだけをSQSへ切り替えるとmessageはqueueへ滞留する。

## Test Coverage
- HTTP default
- HTTP時AWS client未生成
- SQS outbox必須
- Region / HTTPS QueueUrl / Standard-FIFO validation
- Client一回生成・複数enqueue再利用
- Client destroy failure suppression
- Runtime→outbox dispatcher→SQS adapter
- Published更新
- Invalid API startup rejection
- QueueUrl / credentials / attempt key / code / hidden tests非出力

## Review Focus
- SQS選択時のoutbox必須化が妥当か。
- QueueUrl validationが過不足ないか。
- Client lifecycleとdependency injectionが妥当か。
- Legacy / outboxが同じruntimeを利用しているか。
- HTTP既定動作が維持されているか。
- Credential値をapplicationが保持していないか。
- Producer IAMがleast privilegeか。
- Consumer / deployment / AWS resource変更が混在していないか。

## Risks
- Credentialsはlazy resolveされ得るため、API起動成功だけではpublish権限を検証できない。
- 実AWS SQSへのpublishは未実施。
- Consumer未実装。
- Outbox claim / lease未実装。
- Multiple API processではduplicate publishが発生し得る。

## Remaining Tasks
1. Final headのdocs validation / app-qualityを確認する。
2. PR #122本文を完成させる。
3. PR #122をReady for reviewへ変更する。
4. Issue #121へ実装・テスト結果をコメントする。
5. Notion / Linear同期を確認する。
6. Merge後にbranch cleanupを確認する。

## Next Recommended Issue
1. SQS consumer / visibility timeout / DeleteMessage / DLQ PoC
2. AWS resource / IAM role / deployment IaC
3. Outbox claim / lease
4. Queue / outbox metrics backend

本Issueへconsumer、実resource作成、production deployment、Runner、hidden tests、auth、UI変更を混在させない。
