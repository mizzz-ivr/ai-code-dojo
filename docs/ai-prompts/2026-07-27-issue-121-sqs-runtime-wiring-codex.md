# Issue #121 SQS runtime wiring AI実装プロンプトログ

## 依頼
`mizzz-ivr/ai-code-dojo`で、Issue #119 / PR #120のSQS producer adapterへAWS SDK for JavaScript v3を接続し、API起動時にHTTP / SQS queue transportを選択できるruntime wiringを実装する。

## 最優先ルール
- `docs/ai-protocol/PROMPT.txt`を最優先とする。
- APIで提出コードを直接実行しない。
- hidden tests詳細をlearner・Issue・PR・docs・logsへ出さない。
- challengeはversion追加方式を維持する。
- 無関係な変更・リネーム・整形を混在させない。
- branch名に`codex`を含めない。
- PR・commit・docsは日本語で作成する。

## 目的
- `@aws-sdk/client-sqs`を導入する。
- `API_QUEUE_TRANSPORT=http|sqs`を追加し、既定値をHTTPとする。
- SQS選択時に既存adapterへ`SQSClient` / `SendMessageCommand`を接続する。
- legacy submissionとoutbox dispatcherで同じruntime enqueueを利用する。
- AWS SDK default credential provider chainを利用する。
- Producer最小IAM policy例を追加する。

## 必須要件
- SQSはtransactional outbox有効時だけ許可する。
- region / HTTPS QueueUrl / Standard-FIFO整合性を起動時検証する。
- HTTP時はAWS clientを生成しない。
- SQS clientはAPI process単位で一度だけ生成し再利用する。
- API終了時にbest-effortでdestroyする。
- SQS send失敗時はoutboxをpendingに維持する。
- Credentials / QueueUrl / raw attempt key / code / tests / raw errorをeventへ出さない。
- Producer IAMは対象queueへの`sqs:SendMessage`だけを基本とする。
- Customer managed KMS key利用時の追加権限を別policy例に分離する。
- Processing lease / attempt fencing / completion guardを変更しない。

## 非対象
- 実AWS resource作成
- Static access key保存
- Production deployment切替
- SQS consumer / ReceiveMessage / DeleteMessage
- Visibility timeout / DLQ
- Worker HTTP endpoint廃止
- LocalStack integration
- Outbox claim / lease
- Runner / auth / UI変更

## テスト
- HTTP既定値
- HTTP時AWS client未生成
- SQS時outbox必須
- Region / QueueUrl / queue type validation
- FIFO suffix境界
- SQS client一回生成・再利用
- Client destroy
- Legacy / outbox共通enqueue
- Runtime経由SQS outbox publish
- 不正設定時API process終了
- 機微情報非出力
- lint / typecheck / unit / integration / schema validation / build / docs validation

## 成果物
- 実装コード
- Unit / integration test
- IAM policy例
- current-status / active-issues / system-overview
- Runbook
- 作業ログ
- Handoff
- 日本語PR本文
