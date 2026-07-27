# current-status（正本）

最終更新: 2026-07-27（Issue #121 SQS runtime wiringをレビュー中）

## この文書の目的
「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ai-code-dojoは、AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- attempt単位idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Queue message contract、producer port、構造化event、application retry backoff、transactional outboxまで実装済み。
- Issue #119 / PR #120でSQS producer adapter PoCを実装・merge済み。
- Issue #121 / PR #122でAWS SDK v3とAPI queue transport runtime wiringを実装し、Ready for review。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## 実装済みのqueue基盤
- Queue message schema version 1はsubmission ID / grading attempt / attempt idempotency key / optional correlation IDだけを許可する。
- `API_QUEUE_TRANSPORT`の既定値は`http`であり、既存HTTP adapterをrollback先として維持する。
- SQS選択時は`API_QUEUE_OUTBOX_ENABLED=1`を必須とし、submissionとpublish intentを先にatomic保存する。
- SQS runtimeはAPI process内で一つの`SQSClient`を生成し、legacy enqueueとoutbox dispatcherで同じruntime enqueueを共有する。
- AWS credentialsはコードや独自設定へ保持せず、AWS SDK v3のdefault credential provider chainへ委譲する。
- SQS QueueUrlはHTTPS absolute URLとして検証し、Standard / FIFOと`.fifo` suffixの整合性を起動時に確認する。
- SQS send成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。
- Message構築失敗を含むqueue eventへ選択transportを正しく記録する。
- Duplicate publish / deliveryを許容し、Worker conditional claim / attempt fencing / processing lease / completion guardで二重採点を防止する。
- Queue observabilityはallowlist fieldだけを出力し、code / tests / secret / credentials / QueueUrl / attempt key / raw error messageを記録しない。
- Learner-safe / internal境界を維持し、hidden tests詳細、attempt key、lease、heartbeat、outbox、queue内部情報は学習者へ返さない。

## Issue #121 / PR #122の変更
- `@aws-sdk/client-sqs`とfrozen lockfileを追加。
- `API_QUEUE_TRANSPORT=http|sqs`を追加。
- SQS利用時のoutbox、region、HTTPS QueueUrl、queue type validationを追加。
- HTTPではAWS clientを生成せず、SQSではclientを一度だけ生成・再利用。
- Legacy submissionとoutbox dispatcherへ共通runtime enqueueを注入。
- API終了時のbest-effort client destroyを追加。
- Producer最小IAM policy例を追加。
- Config / runtime unit test、outbox component integration、startup process integrationを追加。
- docs validation / frozen install / lint / typecheck / unit / integration / schema validation / buildは成功済み。

## 現時点の非対応・運用制約
- 実AWS SQS queue、IAM role、KMS key、VPC endpointは作成しない。
- Production deploymentのtransportは自動的にSQSへ切り替わらない。
- SQS consumer / ReceiveMessage / DeleteMessage / visibility timeout / DLQは未実装。
- ProducerだけをSQSへ切り替えるとmessageがqueueへ滞留する。
- CredentialsやIAM不足はSQS send時に失敗し、outbox rowはpendingのまま再試行対象となる。
- Outbox claim / leaseは未実装で、複数API process間のduplicate publishを許容する。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## 優先順位（直近）
1. Issue #121 / PR #122をレビュー・mergeする。
2. SQS consumer / visibility timeout / DeleteMessage / DLQの非本番PoCを追加する。
3. SQS resource / IAM role / deployment IaCを別Issueで整備する。
4. Outbox claim / leaseを追加する。
5. Queue / outbox eventをmetrics backend / dashboard / alertへ接続する。
6. Runner隔離強化とhidden tests漏洩防止を継続する。

## branch cleanup 状態
- PR #120は2026-07-27にmerge済み。
- PR #120のhead branch `feat/sqs-producer-adapter-poc` は削除確認対象。
- Issue #121の作業branchは `feat/sqs-runtime-wiring`。
- PR #122 merge後にhead branchを削除する。

## 参照先
- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #121: `https://github.com/mizzz-ivr/ai-code-dojo/issues/121`
- PR #122: `https://github.com/mizzz-ivr/ai-code-dojo/pull/122`
- SQS producer adapter runbook: `docs/runbooks/2026-07-26-sqs-producer-adapter-poc-runbook.md`
- SQS runtime wiring runbook: `docs/runbooks/2026-07-27-sqs-runtime-wiring-runbook.md`
- Transactional outbox runbook: `docs/runbooks/2026-07-25-transactional-outbox-runbook.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
