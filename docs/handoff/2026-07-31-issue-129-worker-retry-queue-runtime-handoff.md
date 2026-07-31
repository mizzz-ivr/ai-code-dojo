# Issue #129 Worker retry queue runtime handoff

最終更新: 2026-07-31

## 状態

- Issue: #129
- PR: #130
- Branch: `feat/worker-retry-queue-runtime`
- Code CI: Success
- Final docs CI: 確認対象
- 実AWS deploy: 未実施
- Production transport: HTTP

## 変更概要

Worker-originのapplication retry / stale recoveryを、選択中のHTTP / SQS runtimeへ統合した。

- HTTP: 既存`POST /jobs` self-enqueue
- SQS: Consumerと同一client / QueueUrlへのSendMessage
- Standard / FIFO: QueueUrl suffixで判定
- FIFO: 既存group / dedup契約を再利用
- Worker IAM: Receive / Delete / ChangeVisibility / Sendのみ

## 主要ファイル

- `packages/queue/src/submission-queue.mjs`
- `apps/worker/src/config/queue-consumer-config.mjs`
- `apps/worker/src/services/queue-consumer-runtime.mjs`
- `infra/aws/cloudformation/sqs-queue-stack.json`
- `scripts/lib/sqs-cloudformation-validator.mjs`
- `tests/unit/queue-consumer-config.test.mjs`
- `tests/unit/queue-consumer-runtime.test.mjs`
- `tests/unit/sqs-cloudformation-validator.test.mjs`

## 維持した不変条件

- HTTPを既定値・rollback先として維持
- Queue message schemaを変更しない
- Attempt / keyをtransport層で変更しない
- Processing lease / attempt fencing / completion guardを変更しない
- Invalid / unconfirmed deliveryをackしない
- Hidden tests / code / credentialsをqueue messageへ含めない

## ECS wiring保留理由

- 現行DBは固定SQLite `.data/app.db`。
- API / Workerを別taskへ分けるとDB共有が成立しない。
- 同一taskへ同居するとtask roleが共通になり、API producer / Worker consumer権限を分離できない。
- Managed DB移行または実行トポロジー確定後に別Issueで再検討する。

## Reviewで確認する点

- Process-local default producer registrationのrestore
- Consumer / producerのSQS client共有
- Runtime close順序
- HTTP rollback互換
- FIFO dedup
- Worker IAM action完全一致
- Send失敗時の安全な終端化
- Raw SDK error / QueueUrl非露出

## Merge後

1. Issue #129をcloseする。
2. Branch `feat/worker-retry-queue-runtime`を削除する。
3. 実AWSへは自動反映しない。
4. Staging transport切替は別承認で実施する。
5. 次候補はDLQ replay / purge、metrics、outbox claim / lease、DB移行方針から再評価する。
