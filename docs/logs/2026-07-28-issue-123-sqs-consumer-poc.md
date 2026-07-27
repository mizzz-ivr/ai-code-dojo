# Issue #123 SQS consumer PoC 作業ログ

## Summary

Issue #121 / PR #122で実装したSQS producer runtimeの後続として、Workerへlong polling、visibility延長、DB永続状態確認後のDeleteMessage、DLQ redrive前提の非削除契約を追加した。

## Current Issue / PR

- Issue: #123
- PR: #124
- Branch: `feat/sqs-consumer-poc`
- PR状態: Draft

## Completed Tasks

- PR #122のmergeとIssue #121の完了を確認した。
- 重複Issueがないことを確認しIssue #123を作成した。
- `WORKER_QUEUE_CONSUMER=http|sqs`とSQS consumer設定validationを追加した。
- 注入可能なSQS consumerを追加した。
- `ReceiveMessage` long pollingと`ApproximateReceiveCount`取得を追加した。
- SQS envelopeとBodyを共通queue message contractで検証した。
- 処理中の`ChangeMessageVisibility`をbest-effortで追加した。
- DB永続状態または安全なno-op確認後だけ`DeleteMessage`するack contractを追加した。
- DB所有権喪失・保存未確認・処理例外・不正messageではackを保留した。
- HTTP consumerを既定値・rollback先として維持した。
- Consumer eventへMessageId / delivery countを追加し、ReceiptHandleはallowlistへ追加しなかった。
- Consumer最小IAM policy例を追加した。
- Config / consumer / runtime unit test、component integration、startup validationを追加した。
- SQS consumer / DLQ運用runbookを追加した。

## Technical Decisions

- Worker process単位でSQS clientを一度だけ生成・再利用する。
- `MaxNumberOfMessages=1`として既存の単一submission処理境界を維持する。
- visibility timeoutはdelivery availability、DB processing leaseはcorrectnessを担う。
- visibility延長失敗だけではDB terminal保存を抑止しない。
- DB lease所有権喪失時は結果保存とackを抑止する。
- safe no-opはackし、invalid / unexpected failureは非削除とする。
- DLQ移送はsource queueのRedrivePolicyへ委ね、consumerコードへmaxReceiveCountをベタ書きしない。
- Application retry producerのSQS切替は本Issueへ混在させない。

## Security Review

- QueueUrlはabsolute HTTPS URLとして検証する。
- QueueUrlへcredentials、query、fragmentを許可しない。
- ReceiptHandle、QueueUrl、credentials、raw attempt key、code、tests、raw SDK errorをeventへ出さない。
- Consumer roleは対象queueへの`ReceiveMessage` / `DeleteMessage` / `ChangeMessageVisibility`だけを基本とする。
- Customer managed KMS key利用時だけ対象keyへの`kms:Decrypt`を追加する。
- Exactly-once deliveryへ採点correctnessを依存しない。
- Processing lease / attempt fencing / completion guardを維持する。

## Test Status

初回CIでは新規SQS consumer unit / component testは成功したが、既存`stale-recovery-flow`で一時的なSQLite `database is locked`が発生した。

- 新規component integration: Success
- Unit / lint / typecheck / schema validation: Success
- 失敗原因: 既存stale recovery integrationの一時SQLite lock
- 対応: 無関係な実装修正を混ぜず、failed jobを再実行して再現性を確認
- 調査用workflowはartifact取得後に削除済み

Final headの全品質ゲートを再確認する。

## Risks

- 実AWS queue / DLQ / IAM role / network pathは未検証。
- Consumer停止時はlong polling requestの終了またはclient destroyを待つ。
- DeleteMessage失敗はduplicate deliveryを発生させ得る。
- Visibility延長失敗は同一messageの並行deliveryを発生させ得る。
- DB fencingが正常ならduplicate deliveryは安全なno-opとなる。
- DLQ replay / purgeと本番alertは未実装。
- Worker application retryは現時点でHTTP自己enqueueを維持する。

## Remaining Tasks

- Canonical docsを更新する。
- AI prompt / handoffを追加する。
- Final headのdocs validation / app-qualityを確認する。
- PR #124本文を完成させる。
- PR #124をReady for reviewへ変更する。
- Issue #123へ実装・テスト結果をコメントする。
- Notion / Linear同期を確認する。

## Suggested Next Actions

1. PR #124をレビュー・mergeする。
2. SQS source queue / DLQ / RedrivePolicy / IAM role / deployment IaCを別Issueで実装する。
3. Worker application retry producerを選択queue runtimeへ統合する。
4. DLQ replay / purgeとqueue metrics backendを整備する。
