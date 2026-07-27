# Issue #123 SQS consumer PoC 実装prompt

## 目的

既存HTTP consumerを維持しながら、Workerへ注入可能なSQS consumer PoCを追加する。

## 前提

- `docs/ai-protocol/PROMPT.txt`を最優先する。
- APIで提出コードを直接実行しない。
- hidden tests詳細をlearner・Issue・PR・docs・logsへ出さない。
- queue message schema version 1を変更しない。
- processing lease / attempt fencing / completion guardを維持する。
- exactly-once deliveryを前提にしない。
- PR・コミット・説明は日本語とする。
- branch名に`codex`を含めない。
- 無関係なリファクタリングを混在させない。

## 実装要件

1. `WORKER_QUEUE_CONSUMER=http|sqs`を追加し、既定値を`http`とする。
2. SQS選択時だけregion、absolute HTTPS QueueUrl、long polling、visibility timeout、visibility heartbeatを検証する。
3. Worker process単位で`SQSClient`を一度だけ生成・再利用する。
4. `ReceiveMessage`は一件ずつ取得し、`ApproximateReceiveCount`を要求する。
5. SQS envelopeのMessageId / ReceiptHandle / Bodyを検証する。
6. BodyをJSON parseし、共通queue message parserへ渡す。
7. 処理中は`ChangeMessageVisibility`をbest-effort実行する。
8. `processSubmission`からDB永続状態に基づくack可否を返す。
9. terminal保存、retry処理完了、安全なno-op確認後だけ最新ReceiptHandleで`DeleteMessage`する。
10. invalid message、unexpected error、所有権喪失、保存未確認ではdeleteしない。
11. ReceiptHandle、QueueUrl、credentials、raw attempt key、code、tests、raw SDK errorをeventへ出さない。
12. Source queueのRedrivePolicyとDLQはresource設定としてdocsへ分離する。
13. Consumer IAMは対象queueへのReceiveMessage / DeleteMessage / ChangeMessageVisibilityだけを基本とする。
14. Customer managed KMS key利用時は対象keyへのkms:Decryptを別policy例にする。
15. HTTP `/jobs`、queued recovery、stale scannerをrollback / safety netとして維持する。

## テスト要件

- HTTP既定値とAWS client未生成
- SQS設定の正常系・異常系・境界値
- Long polling input
- Valid messageの処理後DeleteMessage
- 最新ReceiptHandleの利用
- Invalid JSON / contractで非削除
- Processing例外で非削除
- DB永続状態未確認でack deferred
- Visibility延長成功・失敗
- DeleteMessage失敗
- ApproximateReceiveCount event
- ReceiptHandle / QueueUrl / attempt key / code / tests / raw error非出力
- 不正設定でWorkerがlisten前に終了
- Existing HTTP consumer / recovery regression

## 非対象

- 実AWS resource作成
- Production deployment切替
- LocalStack
- DLQ replay / purge API・UI
- Worker HTTP endpoint廃止
- Worker application retry producerのSQS切替
- DB schema変更
- Runner / hidden tests / auth / UI変更
