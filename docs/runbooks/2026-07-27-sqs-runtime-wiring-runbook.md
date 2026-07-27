# SQS runtime wiring runbook

## 目的
APIのqueue producerをHTTPからAmazon SQSへ限定環境で切り替える際の設定、権限、確認、障害対応、rollback手順を定義する。

本runbookはproducer runtimeだけを対象とする。SQS consumer、visibility timeout、DeleteMessage、DLQ、実AWS resource作成、production deploymentは別Issueで扱う。

## 前提
- Issue #117 / PR #118のtransactional outboxが導入済みである。
- Issue #119 / PR #120のSQS producer adapterが導入済みである。
- APIは提出コードを直接実行しない。
- hidden tests詳細、credentials、QueueUrl、attempt keyをlearner responseやeventへ出さない。
- SQS consumerは未実装であるため、producerだけを有効化しても採点処理は開始されない。

## 設定

### HTTP（既定値・rollback先）

```text
API_QUEUE_TRANSPORT=http
```

- `API_QUEUE_TRANSPORT`未指定時もHTTPとなる。
- SQS関連環境変数は参照しない。
- AWS clientを生成しない。
- outbox無効時は既存の保存→同期HTTP enqueueを維持する。

### SQS producer

```text
API_QUEUE_TRANSPORT=sqs
API_QUEUE_OUTBOX_ENABLED=1
API_SQS_REGION=ap-northeast-1
API_SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/<account-id>/<queue-name>
API_SQS_QUEUE_TYPE=standard
```

FIFOの場合:

```text
API_SQS_QUEUE_TYPE=fifo
API_SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/<account-id>/<queue-name>.fifo
```

### 起動時validation
- transportは`http`または`sqs`だけを許可する。
- SQSではoutbox有効を必須とする。
- regionはnon-empty AWS region identifierとする。
- QueueUrlはabsolute HTTPS URLとする。
- QueueUrlへusername、password、query、fragmentを含めない。
- FIFO指定時はqueue nameが`.fifo`で終わる。
- Standard指定時は`.fifo` queueを拒否する。
- 不正設定時はAPIを起動しない。

## credentials
- application固有のaccess key / secret key設定を追加しない。
- AWS SDK v3のdefault credential provider chainを使用する。
- 推奨順はdeployment環境に応じたIAM role / web identity等であり、長期static access keyをRepositoryや環境設定ファイルへ保存しない。
- credential値やprovider sourceをevent、logs、responseへ出さない。
- credential解決はSQS send時に行われ得る。起動成功だけでpublish権限を保証しない。

## IAM最小権限

通常queue:

- `docs/security/iam/sqs-producer-policy.json`
- 対象queue ARNへの`sqs:SendMessage`だけを許可する。

customer managed KMS keyを使うqueue:

- `docs/security/iam/sqs-producer-customer-managed-kms-policy.json`
- 対象queueへの`sqs:SendMessage`
- 対象KMS keyへの`kms:Decrypt`
- 対象KMS keyへの`kms:GenerateDataKey`

producer roleへ次を付与しない。

- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:PurgeQueue`
- queue作成・削除・属性変更権限
- wildcard resource

実環境ではplaceholderを正確なregion、account ID、queue名、KMS key IDへ置換し、IAM policy simulatorまたは限定環境で検証する。

## client lifecycle
- API process起動時に一つの`SQSClient`を生成する。
- legacy submissionとoutbox dispatcherで同じclientを再利用する。
- requestごとにclientを作らない。
- API server close時に`destroy()`をbest-effortで実行する。
- destroy失敗をshutdown失敗へ昇格しない。

## Publish semantics
- SQS adapterは共通queue message schema version 1をMessageBodyへ格納する。
- `SendMessageCommand`成功かつnon-empty MessageId取得時だけ成功とする。
- 成功時だけoutbox rowをpublishedへ更新する。
- SDK例外、権限不足、credential不足、network failure、MessageId欠落はfalseへ正規化する。
- 失敗時はoutbox rowをpendingに維持する。
- duplicate publish / deliveryを許容し、採点correctnessはDB conditional claim / attempt fencing / processing lease / completion guardで担保する。

## 非本番rollout手順
1. SQS queue、IAM role、必要なKMS keyを別のIaC / deployment変更で作成する。
2. Producer IAMを対象queueへのSendMessageだけに限定する。
3. SQS consumerが未実装であることを確認し、producer-only検証環境として扱う。
4. outboxを有効化する。
5. region、QueueUrl、queue typeを設定する。
6. `API_QUEUE_TRANSPORT=sqs`へ変更してAPIを起動する。
7. submission作成後、outboxがpendingからpublishedへ遷移することを確認する。
8. SQS側でMessageBody、group / deduplication metadata、暗号化状態を確認する。
9. queue eventへcredentials、QueueUrl、attempt key、code、tests、raw errorが出ていないことを確認する。
10. consumer実装前はmessageを採点処理へ流さず、検証後にqueueを整理する。

## 監視観点
- `queue.enqueue.succeeded{transport=sqs}`
- `queue.enqueue.failed{transport=sqs}`
- `queue.outbox.publish_succeeded{transport=sqs}`
- `queue.outbox.publish_failed{transport=sqs}`
- pending outbox件数
- oldest pending age
- SQS ApproximateNumberOfMessagesVisible
- AccessDenied / KMS access failureの一般化error type

QueueUrl、credential詳細、raw AWS error messageは監視eventへ出さない。

## 障害対応

### APIが起動しない
確認項目:
- `API_QUEUE_TRANSPORT`
- `API_QUEUE_OUTBOX_ENABLED`
- region
- QueueUrlのHTTPS形式
- Standard / FIFO suffix

設定値自体を公開ログへ貼り付けず、秘密情報を除いた状態で確認する。

### Outboxがpendingのまま
確認項目:
- APIにIAM role / web identityが付与されているか
- 対象queue ARNがpolicyと一致するか
- regionとQueueUrlが一致するか
- customer managed KMS keyの権限があるか
- network / DNS / VPC endpoint経路
- queue policyの明示的deny

pending rowを削除せず、原因修正後の再送に利用する。

### SQSにmessageはあるが採点されない
現時点では想定どおりである。SQS consumerが未実装のため、producer runtimeだけではWorkerへdeliveryされない。

## Rollback
1. `API_QUEUE_TRANSPORT=http`へ戻す。
2. APIを再起動する。
3. SQS clientが生成されないことを確認する。
4. HTTP enqueueが既存Workerへ到達することを確認する。
5. pending outbox rowを保持し、誤って削除しない。
6. SQS上の未処理messageはconsumer / replay方針確定まで隔離して扱う。
7. DB lease / attempt fencing / completion guardを変更しない。

## テスト観点
- HTTP既定値
- HTTP時にAWS clientを生成しない
- SQS時のoutbox必須化
- region / HTTPS QueueUrl / queue type validation
- FIFO suffix境界
- SQS client一回生成・複数enqueue再利用
- best-effort destroy
- legacy / outbox共通runtime enqueue
- SQS成功時published更新
- SQS失敗時pending維持
- 起動時不正設定のprocess終了
- eventへの機微情報非混入

## 未対応
- 実AWS resourceのRepository管理
- production deployment切替
- SQS consumer
- visibility timeout / long polling
- DeleteMessage / ack
- DLQ / replay / purge
- outbox claim / lease
- metrics backend / dashboard / alert本番設定
