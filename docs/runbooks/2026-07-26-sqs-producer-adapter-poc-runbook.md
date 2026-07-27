# SQS producer adapter PoC runbook

## 目的
Issue #119 / PR #120で追加したSQS producer adapterを、AWS SDK・credentials・本番queueへ接続する前に安全に検証する。

本runbookは非本番PoC専用であり、production runtimeのtransport切替手順ではない。

## 現在の境界

実装済み:
- `packages/queue/src/sqs-queue-producer.mjs`
- queue producer port `enqueue(message) -> boolean`
- Standard / FIFO SendMessage input builder
- client / command factory injection
- SQS structured event
- outbox dispatcherへのtransport注入
- fake clientによるunit / component integration test

未実装:
- `@aws-sdk/client-sqs`依存
- AWS credentials provider / IAM role
- SQS queue作成
- API runtime transport切替
- SQS consumer
- visibility timeout / ack / nack
- DLQ / replay / purge
- deployment設定

## Message contract

MessageBodyにはqueue message schema version 1だけを格納する。

```json
{
  "schemaVersion": 1,
  "submissionId": "opaque-submission-id",
  "gradingAttempt": 1,
  "attemptIdempotencyKey": "internal-attempt-key",
  "correlationId": "optional-correlation-id"
}
```

禁止情報:
- 提出コード本文
- visible / hidden tests詳細
- challenge本文
- secret / token / password
- learnerへ不要な内部障害詳細

## Standard queue

構築する基本入力:

```text
QueueUrl
MessageBody
```

初期導入候補はStandard queueとする。

理由:
- 現行correctnessはWorkerのconditional claim / attempt fencing / completion guardが担う。
- exactly-once publishやFIFO deduplicationへ正しさを依存しない。
- duplicate deliveryは正常な障害モードとして扱える。

## FIFO queue

FIFO指定時は以下を追加する。

```text
MessageGroupId
MessageDeduplicationId
```

生成方針:
- `MessageGroupId`: submission IDを含む固定prefix入力のSHA-256
- `MessageDeduplicationId`: submission ID / grading attempt / attempt idempotency keyを含む固定prefix入力のSHA-256
- raw submission IDやraw attempt keyをmetadataへ露出しない
- 同一submissionのattemptは同じgroupへ入れる
- 異なるattemptは異なるdeduplication IDとする

FIFOを採用しても、DB processing lease / attempt fencing / completion guardを維持する。

## Adapter contract

生成時に必須:
- non-empty `queueUrl`
- `queueType = standard | fifo`
- `client.send` function
- `commandFactory` function

publish成功条件:
- queue message contractがvalid
- command生成成功
- `client.send(command)`成功
- responseにnon-empty `MessageId`が存在

失敗時:
- falseを返す
- raw error messageを外へ返さない
- generalized reason / error typeだけをeventへ記録する

## 非本番確認手順

### Unit

```bash
pnpm test:unit
```

確認対象:
- Standard input
- FIFO group / dedup hash
- MessageId成功判定
- SDK例外
- MessageId欠落
- contract不正
- queue config不正
- queue URL / attempt key / raw error非出力

### Component integration

```bash
pnpm test:integration
```

確認対象:
- outbox dispatcherへSQS producerを注入できる
- pending messageがSQS commandへ変換される
- publish成功時にoutbox published更新が呼ばれる
- SQS enqueue eventとoutbox eventのtransportが`sqs`
- 機微情報がeventへ出ない

## 将来のAWS SDK接続例

次のIssueでのみ実装する。

```text
SQSClientを生成
SendMessageCommand factoryを生成
createSqsQueueProducerへclient / commandFactory / queueUrl / queueTypeを注入
outbox dispatcherのenqueueへproducer.enqueueを注入
```

Repositoryへ長期access keyを保存しない。実行環境のIAM roleまたは同等の短期credentialsを前提とする。

## Runtime wiring前チェック

- queue typeをStandard / FIFOのどちらにするか決定したか
- FIFOの場合、queue名・QueueUrlとqueue type設定が一致するか
- APIから必要なAWS endpointへ到達できるか
- IAM permissionを`SendMessage`へ最小化したか
- KMSを使用する場合のpermissionを確認したか
- queue URLをlearner response / structured eventへ出さないか
- publish failureとpending oldest ageを監視できるか
- HTTP adapterへ即時rollbackできるか
- SQS consumer導入前にproducerだけをproductionへ切り替えないか

## Rollout方針

本PRではrolloutしない。

後続Issueで行う順序:
1. AWS SDK依存とconfig validationを追加する。
2. 非本番queueへfake submission messageをpublishする。
3. MessageBodyとmetadataを確認する。
4. consumerを接続せずqueue depthだけ確認する。
5. SQS consumer / visibility / ack / DLQを別PRで実装する。
6. end-to-end障害注入後に限定環境で切り替える。

## Rollback

本PRはruntime未接続のためproduction rollbackは不要。

後続runtime wiringで問題がある場合:
- transport選択をHTTPへ戻す
- SQS producerを無効化する
- pending outbox rowは削除しない
- Worker queued recoveryを安全網として維持する
- DB lease / attempt fencing / completion guardを維持する

## 調査時の禁止事項

- QueueUrlを公開Issueやlearner向けログへ貼らない
- credentialsや署名済みrequestを記録しない
- MessageBodyへ提出コードやhidden testsを追加しない
- raw attempt idempotency keyをeventやFIFO metadataへ直接入れない
- SDK raw error messageをlearner responseへ返さない
