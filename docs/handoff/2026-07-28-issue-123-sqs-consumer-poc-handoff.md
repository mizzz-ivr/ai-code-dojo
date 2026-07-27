# Issue #123 SQS consumer PoC handoff

## Summary

WorkerへSQS consumer PoCを追加し、long polling、visibility延長、DB永続状態確認後のDeleteMessage、invalid / unexpected failure時の非削除を実装した。HTTP consumerは既定値・rollback先として維持する。

## Current State

- Issue: #123
- PR: #124
- Branch: `feat/sqs-consumer-poc`
- PR状態: Draft
- Production: HTTP consumerのまま

## Implemented

- `apps/worker/src/config/queue-consumer-config.mjs`
- `apps/worker/src/services/sqs-queue-consumer.mjs`
- `apps/worker/src/services/queue-consumer-runtime.mjs`
- Worker server runtime wiring
- DB永続状態に基づくack decision
- ReceiveMessage long polling
- ApproximateReceiveCount取得
- ChangeMessageVisibility heartbeat
- DeleteMessage ack
- Consumer structured events
- Consumer最小IAM policy例
- Unit / component integration / startup validation
- Runbook / logs / prompt / handoff

## Runtime Configuration

HTTP:

```text
WORKER_QUEUE_CONSUMER=http
```

SQS:

```text
WORKER_QUEUE_CONSUMER=sqs
WORKER_SQS_REGION=<region>
WORKER_SQS_QUEUE_URL=https://sqs.<region>.amazonaws.com/<account-id>/<queue-name>
WORKER_SQS_WAIT_TIME_SECONDS=20
WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS=90
WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS=30
WORKER_SQS_POLL_ERROR_DELAY_MS=1000
```

## Ack Contract

DeleteMessageする条件:

- terminal結果保存成功
- infrastructure failureのnew attempt enqueue成功
- retry enqueue失敗の終端化成功
- submission不存在
- attempt mismatch
- conditional claimの安全なno-op

DeleteMessageしない条件:

- invalid JSON / contract
- processing exception
- DB processing lease所有権喪失
- terminal保存未確認
- retry状態遷移未確認
- DeleteMessage失敗

## Visibility Boundary

- Queue visibility timeoutはdelivery availabilityを担う。
- DB processing leaseは実行所有権とcorrectnessを担う。
- Visibility延長失敗だけではDB結果保存を抑止しない。
- DB所有権喪失時は結果保存とackを抑止する。
- Duplicate deliveryはconditional claim / attempt fencing / completion guardで無害化する。

## DLQ Boundary

- DLQ移送はsource queueのRedrivePolicyで設定する。
- `maxReceiveCount=5`とDLQ retention 14日は初期候補であり、コードへ固定していない。
- DLQとsubmission `infra_failed`を分離する。
- Replay / purgeは本Issueの非対象。
- Replay前にDB status / completion guard / attempt / keyを再検証する。

## IAM

通常consumer:

- `docs/security/iam/sqs-consumer-policy.json`
- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:ChangeMessageVisibility`

Customer managed KMS key:

- `docs/security/iam/sqs-consumer-customer-managed-kms-policy.json`
- 上記SQS権限
- `kms:Decrypt`

## Security Boundary

- ReceiptHandleをevent / responseへ出さない。
- QueueUrl、credentials、raw attempt key、code、tests、raw SDK errorをeventへ出さない。
- MessageIdとdelivery countは内部observabilityとして許可する。
- Learnerへqueue / DLQ / delivery countを返さない。

## Test Coverage

- HTTP default / AWS client未生成
- SQS config validation
- Long polling input
- Valid message処理後ack
- Invalid JSON / contract非削除
- Processing exception非削除
- Ack deferred
- Visibility extension failure
- Receive failure
- Runtime client lifecycle
- Startup validation
- Safe no-op ack / invalid contract component integration

## CI Note

初回integrationでは既存`stale-recovery-flow`に一時的なSQLite lockが発生した。新規SQS consumer component testは成功している。無関係な修正は混在させず、failed jobの再実行で再現性を確認する。

## Risks

- 実AWS queue / DLQ / IAM role / KMS / network pathは未検証。
- DeleteMessage失敗時は再配送される。
- Visibility延長失敗時は同一messageが並行配送され得る。
- Consumer単体をSQSへ切り替える前にproducer / queue / RedrivePolicyを同一環境で整合させる必要がある。
- Worker application retry producerはHTTP self-enqueueを維持する。
- Metrics backend / alert未実装。

## Remaining Tasks

1. Canonical docsを更新する。
2. Final headのdocs validation / app-qualityを確認する。
3. PR #124本文を完成させる。
4. PR #124をReady for reviewへ変更する。
5. Issue #123へ実装・テスト結果をコメントする。
6. Notion / Linear同期を確認する。
7. Merge後にbranch cleanupを確認する。

## Next Recommended Issue

1. SQS source queue / DLQ / RedrivePolicy / IAM role / deployment IaC
2. Worker application retry producerのqueue runtime統合
3. DLQ replay / purge運用
4. Queue / outbox metrics backend

本Issueへ実AWS resource作成、production deployment、Runner、hidden tests、auth、UI変更を混在させない。
