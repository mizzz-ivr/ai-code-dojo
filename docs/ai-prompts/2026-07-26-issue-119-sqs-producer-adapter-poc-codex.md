# Issue #119 SQS producer adapter PoC 実装プロンプト

あなたは`mizzz-ivr/ai-code-dojo`のシニアバックエンドエンジニア兼レビュアーです。

## 目的
transactional outbox dispatcher配下へ、queue producer portに準拠するAmazon SQS producer adapterの非本番PoCを追加してください。

## 最優先ルール
- `docs/ai-protocol/PROMPT.txt`を最優先とする。
- APIで提出コードを直接実行しない。
- hidden tests詳細をlearner・Issue・PR・docs・logsへ出さない。
- challengeを直接上書きせずversion追加方式を維持する。
- 無関係な変更、不要なリネーム、不要な整形を混在させない。
- PR、コミットコメント、説明文は日本語にする。
- branch名に`codex`を含めない。

## 前提
- queue message schema version 1が存在する。
- producer portは`enqueue(message) -> boolean`である。
- HTTP adapterがproduction runtimeで利用されている。
- transactional outbox dispatcherがproducerへmessageを渡す。
- Worker conditional claim / attempt fencing / processing lease / completion guardが採点correctnessを担う。

## 実装要件

### SQS producer adapter
- `packages/queue/src/sqs-queue-producer.mjs`を追加する。
- `createSqsQueueProducer`をexportする。
- AWS SDK clientとcommand factoryは注入可能にする。
- RepositoryへAWS SDK依存を追加しない。
- QueueUrlを必須とする。
- queue typeは`standard` / `fifo`を明示的に検証する。
- messageは共通queue contractで検証する。

### Standard queue
- `QueueUrl`
- version付き`MessageBody`

だけを基本inputとする。

### FIFO queue
- `MessageGroupId`をsubmission単位で安定するSHA-256 digestとして生成する。
- `MessageDeduplicationId`をsubmission / grading attempt / attempt keyからSHA-256 digestとして生成する。
- raw submission IDやraw attempt keyをFIFO metadataへ直接入れない。
- 異なるattemptは異なるdeduplication IDとする。

### 成功・失敗判定
- command生成成功
- `client.send`成功
- responseにnon-empty `MessageId`

のすべてを満たす場合だけtrueを返す。

以下はfalseとする。
- contract不正
- command生成例外
- SDK例外
- MessageId欠落

### Observability
既存の以下を使用する。
- `queue.enqueue.succeeded`
- `queue.enqueue.failed`

許可field:
- `transport = sqs`
- `provider = aws`
- `queueType`
- source / outcome / reason
- submission ID / grading attempt / correlation ID / schema version
- generalized error type

禁止field:
- QueueUrl
- credentials
- raw attempt key
- code
- visible / hidden tests
- raw error message

### Outbox dispatcher
- transport名を注入可能にする。
- 既定値は`http`を維持する。
- SQS producer注入時はoutbox eventのtransportを`sqs`とする。
- publish状態遷移やretry semanticsを変更しない。

## テスト

### Unit
- Standard input
- FIFO group / dedup hash
- 同一submissionのgroup安定性
- attempt変更時のdedup差異
- MessageId成功
- SDK例外
- MessageId欠落
- contract不正
- config不正
- 機微情報非出力

### Component integration
- outbox dispatcher + fake SQS client
- command input
- publish成功時のpublished更新
- SQS enqueue event
- SQS outbox event
- QueueUrl / attempt key / code / hidden tests非出力

## 非対象
- `@aws-sdk/client-sqs`依存追加
- credentials / IAM / KMS / VPC endpoint
- production queue作成
- API runtime transport切替
- SQS consumer
- visibility timeout / ack / nack / DLQ
- LocalStack
- deployment変更
- Runner / hidden tests / auth / admin / learner UI変更

## 品質ゲート
- docs validation
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm schema:validate`
- `pnpm build`

## 更新対象docs
- `docs/current-status.md`
- `docs/active-issues.md`
- `docs/architecture/system-overview.md`
- 専用runbook
- 作業ログ
- AIプロンプトログ
- handoff

## レビュー観点
- Standard / FIFO contractが明確か。
- FIFO metadataへraw attempt keyが露出しないか。
- MessageId欠落を成功扱いしていないか。
- eventへQueueUrlやraw errorが混入しないか。
- HTTP runtimeの既存挙動を変更していないか。
- AWS SDK runtime wiringやconsumerを混在させていないか。
- existing DB fencingを維持しているか。
