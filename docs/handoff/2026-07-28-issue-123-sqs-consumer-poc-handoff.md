# Issue #123 SQS consumer PoC handoff

## Summary

WorkerへSQS consumer PoCを追加し、long polling、visibility延長、DB永続状態確認後のDeleteMessage、invalid / unexpected failure時の非削除を実装した。HTTP consumerは既定値・rollback先として維持する。

## Current State

- Issue: #123
- PR: #124
- Branch: `feat/sqs-consumer-poc`
- PR状態: Ready for review
- CI状態: docs validation / app-quality成功
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
- DeleteMessage失敗時の非削除test
- Existing stale recovery integrationのSQLite busy retry
- Canonical docs / runbook / logs / prompt / handoff

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

- Terminal結果保存成功
- Infrastructure failureのnew attempt enqueue成功
- Retry enqueue失敗の終端化成功
- Submission不存在
- Attempt mismatch
- Conditional claimの安全なno-op

DeleteMessageしない条件:

- Invalid JSON / contract
- Processing exception
- DB processing lease所有権喪失
- Terminal保存未確認
- Retry状態遷移未確認
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
- DeleteMessage failure
- Receive failure
- Runtime client lifecycle
- Startup validation
- Safe no-op ack / invalid contract component integration
- Existing HTTP / queued recovery / stale recovery / application retry regression

## CI Result

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit: Success
- Integration: Success
- Schema validation: Success
- Build: Success

初回integrationでは既存`stale-recovery-flow`に一時SQLite lockが発生した。Production repositoryやtransaction処理は変更せず、test polling helperだけで一時busyを再試行するようにした。

## Review Focus

- DB永続状態確認後のack条件が十分か。
- Safe no-opをackする境界が妥当か。
- Invalid / unexpected failureをdeleteしていないか。
- Visibility timeoutとDB processing leaseの責務分離が妥当か。
- 最新ReceiptHandleをDeleteMessageへ使用しているか。
- HTTP時にAWS clientを生成していないか。
- ReceiptHandle / raw SDK errorをeventへ出していないか。
- Consumer IAMがleast privilegeか。
- DLQ resource設定がruntimeコードへ混在していないか。

## Risks

- 実AWS queue / DLQ / IAM role / KMS / network pathは未検証。
- DeleteMessage失敗時は再配送される。
- Visibility延長失敗時は同一messageが並行配送され得る。
- Consumer単体をSQSへ切り替える前にproducer / queue / RedrivePolicyを同一環境で整合させる必要がある。
- Worker application retry producerはHTTP self-enqueueを維持する。
- Metrics backend / alert未実装。

## Remaining Tasks

1. Final management docs同期後のdocs validation / app-qualityを確認する。
2. Issue #123へ実装・テスト結果をコメントする。
3. Notion / Linear同期を確認する。
4. Merge後にIssue closeとbranch cleanupを確認する。

## Next Recommended Issue

1. SQS source queue / DLQ / RedrivePolicy / IAM role / deployment IaC
2. Worker application retry producerのqueue runtime統合
3. DLQ replay / purge運用
4. Queue / outbox metrics backend

本Issueへ実AWS resource作成、production deployment、Runner、hidden tests、auth、UI変更を混在させない。
