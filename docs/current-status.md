# current-status（正本）

最終更新: 2026-07-27（Issue #121 SQS runtime wiringをレビュー準備中）

## この文書の目的
「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）
- Repositoryのcanonical full nameは `mizzz-ivr/ai-code-dojo`。
- ai-code-dojoは、AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- docs正本は `README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- attempt単位idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Issue #111 / PR #112でqueue message contractとproducer port、Issue #113 / PR #114で構造化queue eventを実装済み。
- Issue #115 / PR #116でapplication retryのexponential backoff + full jitter seamを実装済み。
- Issue #117 / PR #118でtransactional outboxを実装済み。
- Issue #119 / PR #120でSQS producer adapter PoCを実装・merge済み。
- Issue #121 / PR #122でAWS SDK v3とAPI queue transport runtime wiringを実装中。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## 稼働中・実装済みの運用基盤
- 採点系はAPI→Workerの非同期連携を維持し、APIで提出コードを直接実行しない。
- queue message schema version 1はsubmission ID / grading attempt / attempt idempotency key / optional correlation IDだけを許可する。
- `API_QUEUE_TRANSPORT`の既定値は`http`であり、既存HTTP adapterをrollback先として維持する。
- SQS選択時は`API_QUEUE_OUTBOX_ENABLED=1`を必須とし、submissionとpublish intentを先にatomic保存する。
- SQS runtimeはAPI process内で一つの`SQSClient`を生成し、legacy enqueueとoutbox dispatcherで同じruntime enqueueを共有する。
- AWS credentialsはコードや独自設定へ保持せず、AWS SDK v3のdefault credential provider chainへ委譲する。
- SQS QueueUrlはHTTPS absolute URLとして検証し、Standard / FIFOと`.fifo` suffixの整合性を起動時に確認する。
- SQS send成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。
- duplicate publish / deliveryは正常な障害モードとして許容し、Worker conditional claim / attempt fencing / processing lease / completion guardで二重採点を防止する。
- queue observabilityはallowlist fieldだけをJSON Linesへ出力し、code / tests / secret / credentials / QueueUrl / attempt key / raw error messageを記録しない。
- learner-safe / internal境界を維持し、hidden tests詳細、attempt key、lease、heartbeat、outbox、queue内部情報は学習者へ返さない。
- CIはlint / typecheck / unit / integration / schema validation / build / docs validationを品質ゲートとする。

## 進行中事項
- Issue #121: `@aws-sdk/client-sqs`を依存へ追加し、frozen lockfileを更新する。
- Issue #121: `API_QUEUE_TRANSPORT=http|sqs`とSQS設定validationを追加する。
- Issue #121: HTTPではAWS clientを生成せず、SQSでは一つのclientを再利用するruntime factoryを追加する。
- Issue #121: legacy submissionとtransactional outboxへ同じruntime enqueueを注入する。
- Issue #121: API終了時にSQS clientをbest-effortでdestroyする。
- Issue #121: producer role向け最小IAM policy例を追加する。
- Issue #121: unit / component integration testとRepository運用docsを整備する。

## 直近完了事項
- Issue #119 / PR #120を2026-07-27に完了し、Standard / FIFO対応のSQS producer adapter、SHA-256 metadata、構造化event、component integration testを実装した。
- Issue #117 / PR #118を完了し、transactional outbox、atomic submission作成、pending dispatcher、feature flag、migration / unit / integration testを実装した。
- Issue #115 / PR #116を完了し、application retryのexponential backoff + full jitterを実装した。
- Issue #113 / PR #114を完了し、queue transportの構造化イベントログとfield allowlistを実装した。
- Issue #111 / PR #112を完了し、version付きmessage contract、producer port、HTTP adapter、producer / consumer共通validationを実装した。

## 現時点の非対応・運用制約
- 実AWS SQS queue、IAM role、KMS key、VPC endpointはこのRepository変更では作成しない。
- production deploymentのtransportは自動的にSQSへ切り替わらない。
- SQS consumer / ReceiveMessage / DeleteMessage / visibility timeout / DLQは未実装。
- ProducerだけをSQSへ切り替えてもconsumerが存在しない環境ではmessageがqueueへ滞留する。
- credentialsやIAM不足はSQS send時に失敗し、outbox rowはpendingのまま再試行対象となる。
- outbox claim / leaseは未実装で、複数API process間のduplicate publishを許容する。
- SQLite fileを複数ホストから共有する運用は前提にしない。

## 優先順位（直近）
1. Issue #121 / PR #122: AWS SDK runtime wiring・設定validation・IAM例を完了する。
2. 後続P2: SQS consumer / visibility timeout / DeleteMessage / DLQの非本番PoCを追加する。
3. 後続P2: outbox claim / leaseを追加し、複数API processの競合を制御する。
4. 後続P2: queue / outbox eventをmetrics backend / dashboard / alertへ接続する。
5. 後続P2: durable application retry schedulingを設計する。
6. 継続: Runner隔離強化とhidden tests漏洩防止を改善する。

## branch cleanup 状態
- PR #120は2026-07-27にmerge済み。
- PR #120のhead branch `feat/sqs-producer-adapter-poc` は削除確認対象。
- Issue #121の作業branchは `feat/sqs-runtime-wiring`。
- PR #122 merge後にhead branchを削除する。

## 参照先
- Repository: `https://github.com/mizzz-ivr/ai-code-dojo`
- Issue #121: `https://github.com/mizzz-ivr/ai-code-dojo/issues/121`
- PR #122: `https://github.com/mizzz-ivr/ai-code-dojo/pull/122`
- Issue #119: `https://github.com/mizzz-ivr/ai-code-dojo/issues/119`
- PR #120: `https://github.com/mizzz-ivr/ai-code-dojo/pull/120`
- SQS producer adapter runbook: `docs/runbooks/2026-07-26-sqs-producer-adapter-poc-runbook.md`
- SQS runtime wiring runbook: `docs/runbooks/2026-07-27-sqs-runtime-wiring-runbook.md`
- transactional outbox runbook: `docs/runbooks/2026-07-25-transactional-outbox-runbook.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
