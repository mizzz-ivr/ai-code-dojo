# SQS consumer PoC 運用runbook

最終更新: 2026-07-28（Issue #123 / PR #124）

## 目的

WorkerのSQS consumer PoCについて、起動設定、正常時のack条件、visibility timeout、異常時の非削除、DLQ redrive、rollbackを安全に運用する。

本runbookは非本番PoCを対象とする。実AWS queue / DLQ / IAM role / KMS key / deploymentは本PRでは作成しない。

## 不変条件

- APIで提出コードを直接実行しない。
- queue messageはschema version 1の参照情報だけを保持する。
- hidden tests詳細、提出コード、secret、ReceiptHandle、raw attempt key、QueueUrl、raw SDK errorをeventへ出さない。
- queue visibility timeoutへ採点correctnessを依存しない。
- DB processing lease / attempt fencing / completion guardを維持する。
- exactly-once deliveryを前提にしない。
- transport retryではgrading attemptとattempt keyを変更しない。
- DLQとsubmissionの`infra_failed`を分離する。

## 既定動作

```text
WORKER_QUEUE_CONSUMER=http
```

既定値はHTTPであり、SQS clientを生成しない。既存`POST /jobs`、queued recovery、stale scannerを維持する。

## SQS consumer設定

```text
WORKER_QUEUE_CONSUMER=sqs
WORKER_SQS_REGION=ap-northeast-1
WORKER_SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/<account-id>/<queue-name>
WORKER_SQS_WAIT_TIME_SECONDS=20
WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS=90
WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS=30
WORKER_SQS_POLL_ERROR_DELAY_MS=1000
```

### Validation

- `WORKER_SQS_WAIT_TIME_SECONDS`: 1〜20秒
- `WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS`: 1〜43200秒
- `WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS`: 正の整数かつvisibility timeoutの3分の1以下
- QueueUrl: absolute HTTPS URL
- QueueUrlにcredentials、query、fragmentを含めない
- queue nameを必須とする
- 不正設定はWorkerのlisten開始前に拒否する

## ReceiveMessage契約

consumerは次の条件でlong pollingする。

```text
MaxNumberOfMessages = 1
WaitTimeSeconds = WORKER_SQS_WAIT_TIME_SECONDS
VisibilityTimeout = WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS
AttributeNames = ApproximateReceiveCount
```

`MessageId`、`ReceiptHandle`、`Body`が欠落するdeliveryは処理しない。BodyはJSON parse後に共通queue message parserで検証する。

## 正常処理とack条件

`DeleteMessage`は次のいずれかをDBまたは既存の安全境界で確認した後だけ実行する。

- terminal結果をfenced updateで保存できた
- infrastructure failureをnew attempt enqueueまたは終端化まで処理できた
- submission不存在を安全なno-opとして確認した
- current attemptとの不一致を安全な旧messageとして確認した
- conditional claim失敗をduplicate / terminal / 他Worker所有の安全なno-opとして確認した

DeleteMessageには、そのdeliveryで受信した最新ReceiptHandleを使用する。

## ackを保留する条件

次の場合はDeleteMessageを実行しない。

- Bodyが不正JSON
- queue message contract不正
- consumer処理の予期しない例外
- DB processing lease所有権喪失
- terminal保存結果を確認できない
- retry状態遷移、new attempt作成、retry enqueue、終端化を確認できない
- DeleteMessage自体が失敗した

messageはvisibility expiry後の再配送またはqueue resourceのRedrivePolicyへ委ねる。

## visibility延長

処理開始後、`WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS`間隔で`ChangeMessageVisibility`をbest-effort実行する。

- 延長値は`WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS`
- visibility延長失敗だけではDB結果保存を抑止しない
- DB lease所有権を失った場合は結果保存とackを抑止する
- ReceiptHandleはeventへ記録しない
- visibility timeoutはDB processing leaseより長い値を初期候補とし、実行時間の計測後に調整する

## DLQ / RedrivePolicy

DLQ移送はconsumerコードではなく、source queueのRedrivePolicyで構成する。

初期候補:

```json
{
  "deadLetterTargetArn": "arn:aws:sqs:<region>:<account-id>:<dlq-name>",
  "maxReceiveCount": "5"
}
```

- `maxReceiveCount=5`は設計上の初期候補であり、実測後に変更する。
- DLQ retentionの初期候補は14日とする。
- source queueよりDLQのretentionを短くしない。
- learner codeの通常失敗、test failure、terminal済みduplicate、旧attempt、安全なattempt mismatchをDLQ理由として扱わない。
- 不正schema、繰り返すconsumer / DB接続障害、未対応versionなどを隔離対象候補とする。
- DLQ replay / purgeは本Issueの非対象とし、後続のops権限付き手順でDB状態を再検証してから行う。

## IAM

通常consumerの例:

- `docs/security/iam/sqs-consumer-policy.json`
- 対象queueへの`ReceiveMessage` / `DeleteMessage` / `ChangeMessageVisibility`だけを許可する

Customer managed KMS key利用時:

- `docs/security/iam/sqs-consumer-customer-managed-kms-policy.json`
- 対象keyへの`kms:Decrypt`を追加する

Consumer roleへproducer、purge、queue作成・削除・属性変更、wildcard resource権限を付与しない。

## 構造化event

主なevent:

- `queue.delivery.accepted`
- `queue.delivery.rejected`
- `queue.consumer.poll_failed`
- `queue.consumer.processing_failed`
- `queue.visibility.extended`
- `queue.visibility.extension_failed`
- `queue.ack.succeeded`
- `queue.ack.deferred`
- `queue.ack.failed`

許可fieldはMessageId、delivery count、submission ID、grading attempt、correlation ID、schema version、一般化reason / error typeに限定する。

## 障害確認

### ReceiveMessage失敗

1. `queue.consumer.poll_failed`を確認する。
2. IAM、region、QueueUrl、network pathを確認する。
3. raw SDK errorやcredentialsをログへ転記しない。
4. pollingは設定delay後に再試行される。

### visibility延長失敗

1. `queue.visibility.extension_failed`を確認する。
2. DB heartbeat / lease所有権を確認する。
3. duplicate deliveryはDB conditional claimで無害化する。
4. 連続発生時はvisibility timeout、network、IAMを確認する。

### ack deferred

1. `queue.ack.deferred`の一般化reasonを確認する。
2. submission status、completion guard、current attempt、processing leaseを内部経路で確認する。
3. messageを手動削除しない。
4. visibility expiry後の再配送とDB fencingに委ねる。

### DLQ増加

1. queue depth、oldest age、ApproximateReceiveCount、一般化failure reasonを確認する。
2. learner-facing responseへDLQ情報を出さない。
3. replay前にsubmission存在、queued状態、completion guard未設定、attempt / key一致を確認する。
4. security incident疑いがある場合は自動purgeしない。

## Rollout

本PRだけではproductionをSQS consumerへ切り替えない。

限定環境では次の順に進める。

1. Source queue / DLQ / RedrivePolicyをIaCで作成する。
2. Consumer roleへ最小IAMを付与する。
3. Producer / consumerで同じqueue contractを利用することを確認する。
4. HTTP consumerを既定のままWorkerを起動する。
5. 限定環境だけ`WORKER_QUEUE_CONSUMER=sqs`へ変更する。
6. 正常messageのreceive→claim→terminal保存→DeleteMessageを確認する。
7. duplicate、invalid message、consumer停止、visibility expiry、DeleteMessage失敗を障害注入する。
8. DLQ redriveと機微情報非混入を確認する。
9. metrics / alertを整備後に対象を拡大する。

## Rollback

1. `WORKER_QUEUE_CONSUMER=http`へ戻す。
2. Workerを再起動する。
3. AWS clientが生成されないことを確認する。
4. `POST /jobs`の受理とqueued recoveryを確認する。
5. SQS上のmessageは削除せず隔離し、replay方針確定まで保持する。
6. DB processing lease / stale scanner / attempt fencing / completion guardを維持する。

## 未対応

- 実AWS queue / DLQ / RedrivePolicy作成
- IAM role / KMS key policy / VPC endpoint
- Production deployment切替
- DLQ replay / purge API・UI
- Queue metrics backend / dashboard / alert
- Worker application retry producerのSQS切替
- Outbox claim / lease
