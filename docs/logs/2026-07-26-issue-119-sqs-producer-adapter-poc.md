# Issue #119 SQS producer adapter PoC 作業ログ

## Summary
PR #118のmergeとIssue #117の完了を確認し、次のP2としてtransactional outbox dispatcher配下へ注入可能なSQS producer adapterの非本番PoCを実装した。

## Current Issue / PR
- Issue: #119
- PR: #120
- Branch: `feat/sqs-producer-adapter-poc`
- PR状態: Draft

## Completed Tasks
- PR #118がmergedであることを確認した。
- SQS / external queue producer関連のopen Issueがないことを確認し、Issue #119を作成した。
- `packages/queue/src/sqs-queue-producer.mjs`を追加した。
- Standard / FIFO SendMessage input builderを追加した。
- QueueUrl / queue type / client / command factory validationを追加した。
- FIFO group / deduplication IDをSHA-256で生成した。
- raw attempt keyをFIFO metadataへ直接含めないようにした。
- MessageId取得時だけpublish成功とした。
- SDK例外、MessageId欠落、contract不正をfalseへ正規化した。
- queue eventへprovider / queueType fieldを追加した。
- outbox dispatcherのtransport表記を注入可能にした。
- SQS producer unit testを追加した。
- outbox dispatcher + fake SQS clientのcomponent integration testを追加した。
- current-status / active-issues / system-overviewを更新した。
- SQS producer adapter PoC runbookを追加した。
- Draft PR #120を作成した。

## Technical Decisions
- production runtimeはHTTP adapterのまま維持する。
- AWS SDK依存追加とruntime wiringを本Issueへ混在させない。
- SQSClient / SendMessageCommand相当をclient / command factory injectionで抽象化する。
- Standard queueを初期推奨とする。
- FIFOを選択可能にするが、FIFO deduplicationへ採点correctnessを依存しない。
- FIFO group IDはsubmission単位、deduplication IDはattempt単位とする。
- hash入力にはattempt keyを使用するが、出力はSHA-256 digestだけとする。
- MessageId欠落は成功と扱わない。
- queue URL、credentials、raw error、attempt keyをobservability eventへ出さない。
- outbox dispatcherのtransport eventをHTTP固定から注入へ変更するが、既定値はHTTPを維持する。

## Rejected Alternatives
- 本Issueで`@aws-sdk/client-sqs`を追加する案
  - credentials / IAM / runtime config / deploymentが混在するため不採用。
- 本IssueでSQS consumerまで実装する案
  - visibility timeout / ack / DLQ / Worker lifecycleが大きくなるため別Issueへ分離。
- FIFO MessageDeduplicationIdへraw attempt keyを使用する案
  - 内部識別子の露出を避けるため不採用。
- SQS成功判定を例外なしだけにする案
  - MessageId欠落を検知できないため不採用。
- queue typeをQueueUrl suffixだけで暗黙判定する案
  - configurationを明示しレビューしやすくするため不採用。

## CI Investigation
初回headではlint / typecheck / unit / schema validationが成功し、integrationだけが失敗した。

同一headのintegration再実行でも失敗したが、GitHub connectorのログ表示上限により末尾の失敗詳細を取得できなかった。

切り分け:
- 新規SQS component testはNode 22単独実行で成功した。
- 一時的にintegration failure artifactを追加して再実行した。
- 診断headではintegrationを含む全主要jobが成功し、artifactは生成されなかった。
- 一時診断workflow / runner差分を完全に削除した。
- 診断差分なしの最終コードheadでlint / typecheck / unit / integration / schema validation / buildがすべて成功した。

結論:
- SQS adapter固有の再現可能な不具合は確認されなかった。
- 初回2回のintegration failureは既存process integrationの一時的競合とみられるが、失敗詳細を取得できていないため断定しない。
- 一時診断差分はPRへ残していない。

## Security Review
- MessageBodyはqueue message contractだけを保持する。
- FIFO metadataはSHA-256 digestだけを使用する。
- eventへQueueUrlを出さない。
- eventへcredentialsを出さない。
- eventへattempt keyを出さない。
- eventへraw SDK error messageを出さない。
- code / visible tests / hidden testsをmessage metadataやeventへ出さない。
- learner responseを変更しない。

## Risks
- AWS SDK runtime wiringは未実装。
- 実queueに対するsend testは未実施。
- SQS consumer / visibility timeout / ack / DLQは未実装。
- FIFO queue typeと実QueueUrlの整合性確認は後続runtime configの責務。
- Standard / FIFO選定は未確定。
- outbox claim / leaseは未実装。
- production runtimeはHTTPのままでbroker durabilityを提供しない。

## Test Results
コードheadで以下が成功した。

- lint: Success
- typecheck: Success
- unit: Success
- integration: Success
- schema validation: Success
- build: Success

正本docs追加後にfinal headを再確認する。

## Remaining Tasks
- AIプロンプトログ / handoffを追加する。
- final headのdocs validation / app-qualityを確認する。
- PR #120本文を完成させる。
- PR #120をReady for reviewへ変更する。
- Issue #119へ実装・テスト結果をコメントする。
- Linear / Notion同期可否を確認する。
- merge後にbranch cleanupを確認する。

## Suggested Next Actions
1. PR #120をレビュー・mergeする。
2. `@aws-sdk/client-sqs` runtime wiring / config / IAMを別Issueで実装する。
3. SQS consumer / visibility timeout / ack / DLQ PoCを別Issueで実装する。
4. outbox claim / leaseを追加する。

## Handoff
- `docs/handoff/2026-07-26-issue-119-sqs-producer-adapter-poc-handoff.md`
