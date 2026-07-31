# Worker retry queue runtime runbook

最終更新: 2026-07-31

## 目的

Workerが生成するapplication retryとstale recoveryの再投入を、`WORKER_QUEUE_CONSUMER`で選択中のHTTP / SQS queue runtimeへ統一して運用する。

## 対象

- Application retry後のnew attempt再投入
- Processing lease期限切れsubmissionのstale recovery再投入
- HTTP / SQS transport選択
- Standard / FIFO queue
- Worker queue IAM role

## 対象外

- 実AWS transport切替
- ECS task definition / service / cluster
- SQLiteからmanaged DBへの移行
- Durable retry scheduling
- DLQ replay / purge
- Production自動deploy

## 不変条件

- HTTPを既定値・rollback先として維持する。
- Retry時に`gradingAttempt`と`attemptIdempotencyKey`を新attemptの値から変更しない。
- DB processing lease / attempt fencing / completion guardをcorrectnessの正本とする。
- SQSのat-least-once deliveryを前提とし、exactly-onceへ依存しない。
- QueueUrl、ReceiptHandle、credentials、raw attempt key、raw SDK errorをログへ出さない。
- Hidden testsと提出コードをqueue messageへ含めない。

## HTTP構成

```text
WORKER_QUEUE_CONSUMER=http
WORKER_RETRY_ENQUEUE_BASE_URL=http://localhost:8081
```

- WorkerはAWS clientを生成しない。
- Application retry / stale recoveryは`POST /jobs`へ再投入する。
- `WORKER_RETRY_ENQUEUE_BASE_URL`未指定時は`http://localhost:8081`を使用する。

## SQS構成

```text
WORKER_QUEUE_CONSUMER=sqs
WORKER_SQS_REGION=ap-northeast-1
WORKER_SQS_QUEUE_URL=<source queue URL>
WORKER_SQS_WAIT_TIME_SECONDS=20
WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS=90
WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS=30
WORKER_SQS_POLL_ERROR_DELAY_MS=1000
```

- QueueUrl末尾が`.fifo`ならFIFO、それ以外はStandardとして扱う。
- ConsumerとWorker-origin producerはprocess内で同一`SQSClient`を共有する。
- Retry / stale recoveryはsource queueへ`SendMessage`する。
- FIFO時は既存producerのSHA-256 MessageGroupId / MessageDeduplicationId契約を再利用する。

## IAM

Worker roleはsource queueだけをresourceとして、次のactionを許可する。

- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:ChangeMessageVisibility`
- `sqs:SendMessage`

付与しない権限:

- DLQ read
- `sqs:PurgeQueue`
- Queue作成・削除・属性変更
- Wildcard resource
- Managed policy

Customer managed KMSを採用する場合は、queue操作に加えて対象keyの`kms:Decrypt` / `kms:GenerateDataKey`が必要になる。現行CloudFormation既定はSQS-managed SSEである。

## 起動確認

1. Worker startup時に設定validationが成功することを確認する。
2. HTTP選択時にAWS credential要求が発生しないことを確認する。
3. SQS選択時にsource queueのReceiveMessageが開始されることを確認する。
4. QueueUrlやaccount ID実値をログ・Issue・PRへ転記しない。

## Application retry確認

1. Infrastructure failureを発生させる。
2. Submissionが`retry_pending`を経てnew attemptへ進むことを確認する。
3. HTTPでは`POST /jobs`、SQSではsource queueへのSendMessageが使われることを確認する。
4. Enqueue成功時だけretry処理が完了扱いになることを確認する。
5. Enqueue失敗時はnew attemptが`infra_failed`へ安全に終端化されることを確認する。

## Stale recovery確認

1. Processing lease期限切れのrunning submissionを用意する。
2. Stale scannerがnew attemptを作成することを確認する。
3. 選択中runtimeへ再投入されることを確認する。
4. Enqueue失敗時の`infra_failed`終端化を確認する。
5. 旧attemptからの更新がfencingで拒否されることを確認する。

## Rollback

1. `WORKER_QUEUE_CONSUMER=http`へ戻す。
2. Worker HTTP endpointの到達性を確認する。
3. Workerを再起動する。
4. Queue上の既存messageを削除・purgeしない。
5. DB上のattempt / lease / completion guardを変更しない。
6. SQS roleは即時削除せず、message depthとrollback完了を確認後に別変更で縮小する。

## 障害時

### SendMessage失敗

- Raw SDK errorは記録せず、一般化した`errorType`と`reason=send_failed`だけを記録する。
- Application retry / stale recoveryは成功扱いにしない。
- DB終端化が失敗した場合はmessageをackせず、再配送・stale recoveryに委ねる。

### Client shutdown失敗

- Shutdownはbest-effortとする。
- Poll停止を開始してからclientをdestroyする。
- Credentialsやendpointをログへ出さない。

### FIFO設定不整合

- QueueUrlの`.fifo` suffixを正本とする。
- Standard / FIFO変更は別queue / 別stackで段階移行する。
- Transport切替とqueue replacementを同一変更へ混在させない。

## 検証コマンド

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm schema:validate
pnpm infra:validate
pnpm build
```

## 参照

- Issue #129
- PR #130
- `apps/worker/src/services/queue-consumer-runtime.mjs`
- `packages/queue/src/submission-queue.mjs`
- `infra/aws/cloudformation/sqs-queue-stack.json`
