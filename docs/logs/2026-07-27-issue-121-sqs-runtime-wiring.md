# Issue #121 SQS runtime wiring 作業ログ

## Summary
Issue #119 / PR #120で実装した注入型SQS producer adapterへAWS SDK v3を接続し、API起動時にHTTP / SQS transportを選択できるruntime wiringを追加した。

## Current Issue / PR
- Issue: #121
- PR: #122
- Branch: `feat/sqs-runtime-wiring`
- PR状態: Ready for review

## Completed Tasks
- PR #120のmergeとIssue #119の完了を確認した。
- 重複Issueがないことを確認しIssue #121を作成した。
- `@aws-sdk/client-sqs`をroot dependencyへ追加した。
- Repository指定のpnpm 10.13.1でlockfileを生成し、`--frozen-lockfile`成功を確認した。
- 一時lockfile生成workflowを削除した。
- `API_QUEUE_TRANSPORT=http|sqs`を追加した。
- SQS選択時のoutbox、region、HTTPS QueueUrl、Standard / FIFO validationを追加した。
- API process単位で一つのSQS clientを生成・再利用するqueue runtimeを追加した。
- legacy submissionとoutbox dispatcherへ同じruntime enqueueを注入した。
- API close時のbest-effort client destroyを追加した。
- Message構築失敗eventへ選択transportを反映した。
- Config / runtime unit testを追加した。
- SQS outbox component integration testをruntime経由へ更新した。
- 不正SQS設定でAPIが起動しないprocess integration testを追加した。
- Producer最小IAM policy例を追加した。
- current-status / active-issues / system-overviewを更新した。
- SQS runtime wiring runbook、AI prompt、handoffを追加した。
- PR本文を完成させ、Ready for reviewへ変更した。

## Technical Decisions
- HTTPを既定値とrollback先として維持する。
- SQS transportはtransactional outbox有効時だけ許可する。
- CredentialsはAWS SDK v3 default credential provider chainへ委譲する。
- Access key / secret keyをapplication固有configへ追加しない。
- SQS clientをrequestごとに生成せずAPI process単位で再利用する。
- SQS publish失敗時はoutboxをpendingに維持する。
- Producer IAMは対象queueへの`sqs:SendMessage`だけを基本とする。
- Customer managed KMS key利用時だけ`kms:Decrypt` / `kms:GenerateDataKey`を追加する。
- SQS consumer、AWS resource、production deploymentを本Issueへ混在させない。

## Security Review
- QueueUrlはHTTPS absolute URLとして検証する。
- QueueUrlへcredentials、query、fragmentを許可しない。
- Credentials値やprovider sourceをeventへ出さない。
- QueueUrl、raw attempt key、code、visible / hidden tests、raw SDK errorをeventへ出さない。
- Producer roleへReceiveMessage / DeleteMessage / PurgeQueue / queue管理権限を付与しない。
- Exactly-once deliveryへ採点correctnessを依存しない。
- Processing lease / attempt fencing / completion guardを維持する。

## Review Finding
共通message構築失敗時に既存`enqueueSubmissionAttempt`が`transport=http`を固定記録していたため、SQS runtimeでも失敗eventがHTTP扱いになる問題を確認した。

対応:
- `enqueueSubmissionAttempt`へ既定`http`のtransport引数を追加
- Queue runtimeから選択transportを注入
- SQS message構築失敗時のevent分類testを追加

## Test Results
最終コード・docs反映headで以下が成功した。

- docs validation: Success
- frozen lockfile install: Success
- lint: Success
- typecheck: Success
- unit: Success
- integration: Success
- schema validation: Success
- build: Success

Ready状態同期後のheadでも同じ品質ゲートを再確認する。

## Risks
- Credentialsはlazy resolveされ得るため、API起動成功はSQS publish権限成功を保証しない。
- SQS consumer未実装のため、producerを有効化するとmessageがqueueへ滞留する。
- 実AWS queue / IAM role / KMS / network pathは未検証。
- Production deploymentは変更していない。
- Outbox claim / lease未実装のため、複数API processでduplicate publishが発生し得る。

## Remaining Tasks
- Ready状態同期後のfinal headでdocs validation / app-qualityを確認する。
- Issue #121へ実装・テスト結果をコメントする。
- Notion / Linear同期を確認する。
- Merge後にbranch cleanupを確認する。

## Suggested Next Actions
1. PR #122をレビュー・mergeする。
2. SQS consumer / visibility timeout / DeleteMessage / DLQ PoCを別Issueで実装する。
3. AWS resource / IAM role / deployment IaCを別Issueで実装する。
4. Outbox claim / leaseを追加する。
