# Issue #119 SQS producer adapter PoC handoff

## Summary
transactional outbox dispatcher配下へ注入可能なSQS producer adapterを追加し、Standard / FIFOのSendMessage contractをAWS SDK・credentials・runtime wiringなしで検証した。

## Current State
- Issue: #119
- PR: #120
- Branch: `feat/sqs-producer-adapter-poc`
- PR状態: Ready for review準備完了
- CI状態: final headでdocs validation / app-quality全成功

## Implemented
- `packages/queue/src/sqs-queue-producer.mjs`
- `SQS_QUEUE_TYPES`
- `buildSqsSendMessageInput`
- `createSqsQueueProducer`
- QueueUrl / queue type validation
- client / command factory injection
- Standard queue input
- FIFO group / deduplication SHA-256 metadata
- MessageId success validation
- generalized SQS enqueue events
- queue event `provider` / `queueType` allowlist
- outbox dispatcher transport injection
- SQS producer unit test
- outbox + fake SQS client component integration test
- current-status / active-issues / system-overview
- SQS producer adapter PoC runbook
- 作業ログ / AIプロンプトログ / handoff

## Production State
- production runtimeはHTTP adapterを継続利用する。
- SQS adapterはruntime transport選択へ未接続。
- Repositoryへ`@aws-sdk/client-sqs`依存を追加していない。
- credentials / IAM / KMS / VPC endpoint / deploymentを変更していない。
- SQS consumerを追加していない。

## Producer Contract

```text
createSqsQueueProducer({
  client,
  commandFactory,
  queueUrl,
  queueType,
  source,
  eventLogger
})

producer.enqueue(message) -> boolean
```

成功条件:
- valid queue message
- command生成成功
- client.send成功
- non-empty MessageId

失敗時はfalseを返し、raw errorを外へ出さない。

## Standard Queue

```text
QueueUrl
MessageBody = JSON.stringify(queue message schema v1)
```

Standard queueを初期候補とする。duplicate deliveryはWorker DB fencingで無害化する。

## FIFO Queue

```text
MessageGroupId = SHA-256(submission group input)
MessageDeduplicationId = SHA-256(submission / attempt / attempt key input)
```

- 同一submissionは同一groupになる。
- attemptが変わるとdeduplication IDが変わる。
- raw submission ID / raw attempt keyをmetadataへ直接出さない。
- FIFO deduplicationだけにcorrectnessを依存しない。

## Observability

SQS producer event:
- `queue.enqueue.succeeded`
- `queue.enqueue.failed`

主なfield:
- `transport = sqs`
- `provider = aws`
- `queueType = standard | fifo`
- source / outcome / reason
- submission ID / grading attempt / correlation ID / schema version
- generalized error type

禁止field:
- QueueUrl
- credentials
- raw attempt idempotency key
- code
- visible / hidden tests
- raw error message

Outbox dispatcherはtransportを注入可能にし、SQS注入時のoutbox eventを`sqs`として記録する。既定値は`http`を維持する。

## CI Investigation
初回コードhead:
- lint: Success
- typecheck: Success
- unit: Success
- schema validation: Success
- integration: Failure

同一headのintegration再実行もFailureだった。

切り分け:
- 新規SQS component testはNode 22単独実行で成功した。
- 一時diagnostic artifactを追加したheadではintegrationを含む主要jobが成功した。
- artifactは失敗がなかったため生成されなかった。
- diagnostic workflow / runner変更を完全に削除した。
- 診断差分なしのコードheadでlint / typecheck / unit / integration / schema validation / buildが成功した。
- 正本docs反映後のfinal headでもdocs validationを含む全品質ゲートが成功した。

初回失敗の詳細ログを取得できていないため原因は断定しない。既存process integrationの一時的競合の可能性がある。

## Final CI
- docs validation: Success
- lint: Success
- typecheck: Success
- unit: Success
- integration: Success
- schema validation: Success
- build: Success

## Correctness Boundary
- SQS producerはdelivery availabilityだけを担う。
- outboxはpublish intent durabilityを担う。
- Worker conditional claim / attempt fencing / processing lease / completion guardが採点correctnessを担う。
- transport publishでgrading attempt / attempt keyを変更しない。
- exactly-once deliveryへ依存しない。
- duplicate publish / deliveryを許容する。

## Review Focus
- Standard / FIFO SendMessage inputが妥当か。
- FIFO group / dedup hashの入力境界が妥当か。
- raw attempt keyがmetadataやeventへ露出しないか。
- MessageId欠落を失敗扱いしているか。
- SDK例外をfalseへ安全に正規化しているか。
- command factory injectionが将来AWS SDK wiringに使えるか。
- outbox dispatcherの既定HTTP挙動を維持しているか。
- production runtimeにSQSを誤接続していないか。
- AWS SDK / credentials / consumer / deploymentを混在させていないか。

## Risks
- 実AWS SQSに対するpublish未検証。
- AWS SDK runtime wiring未実装。
- IAM / credentials / KMS / endpoint設計未実装。
- QueueUrlとqueue type設定の整合性確認は後続configの責務。
- SQS consumer / visibility / ack / DLQ未実装。
- Standard / FIFOの最終選定未確定。
- outbox claim / lease未実装。
- production runtimeはHTTPでbroker durabilityなし。

## Remaining Tasks
1. PR #120本文を完成させる。
2. PR #120をReady for reviewへ変更する。
3. Issue #119へ実装・テスト結果をコメントする。
4. Linear / Notion同期可否を確認する。
5. merge後にbranch cleanupを確認する。

## Next Recommended Issue
1. AWS SDK runtime wiring / transport config / IAM / deployment
2. SQS consumer / visibility timeout / DeleteMessage / DLQ PoC
3. outbox claim / lease
4. queue / outbox metrics backend

本Issueへ実queue作成、credentials、consumer、DLQ、deployment、Runner、hidden tests、auth、UI変更を混在させない。
