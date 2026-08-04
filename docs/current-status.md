# current-status（正本）

最終更新: 2026-08-01（Issue #131 Managed DB / ECS topology設計中）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態（要約）

- Repositoryのcanonical full nameは`mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- Docs正本は`README.md` / `docs/project-overview.md` / `docs/current-status.md` / `docs/active-issues.md` / `docs/architecture/system-overview.md`。
- Attempt idempotency key、completion guard、processing lease / heartbeat、stale running自動回収まで実装済み。
- Queue message contract、HTTP / SQS producer / consumer、構造化event、application retry backoff、transactional outboxまで実装済み。
- Issue #125 / PR #126でSQS source queue / DLQ / RedrivePolicy / workload IAM roleのCloudFormation IaCをmerge済み。
- Issue #127 / PR #128でstaging GitHub OIDC認証とreview-only change set workflowをmerge済み。
- Issue #129 / PR #130でWorker application retry / stale recoveryを選択中queue runtimeへ統合済み。
- Issue #131でManaged DB移行とAPI / Worker実行トポロジーをdocs-onlyで設計中。
- Linearは無料Issue上限のためIssue #131を登録できず、GitHub Issue / Repository docs / Notionを管理正本とする。
- API直接実行禁止、hidden tests非公開、challenge version追加方式の不変条件を維持する。

## 現行runtime

### Database

- 現行providerはSQLite。
- Fileはprocess working directory配下の`.data/app.db`。
- API / Workerは同じlogical databaseへアクセスする前提である。
- `node:sqlite`の`DatabaseSync`、sync prepared statement、`BEGIN IMMEDIATE`を使用している。
- Production相当のRDS / PostgreSQL resourceは未作成。

### Queue

#### API producer

- `API_QUEUE_TRANSPORT=http|sqs`。
- 既定値は`http`。
- SQS選択時はtransactional outboxを必須とする。
- API process単位で1つのSQS clientを生成し、legacy enqueueとoutbox dispatcherで共有する。
- SQS send成功時だけoutboxをpublishedへ更新し、失敗時はpendingを維持する。

#### Worker consumer

- `WORKER_QUEUE_CONSUMER=http|sqs`。
- 既定値は`http`。
- HTTPでは`POST /jobs`をrollback先として維持する。
- SQSでは1件ずつlong pollingし、processing中にvisibilityをbest-effort延長する。
- DB terminal保存、retry処理完了、安全なno-op確認後だけ最新ReceiptHandleでDeleteMessageする。
- Invalid message、unexpected error、DB ownership喪失、保存未確認ではmessageを削除しない。

#### Worker-origin requeue

- Worker runtimeは選択transportのproducerを保持し、`enqueue()` portを提供する。
- Application retryはserverからruntime `enqueue()`を直接呼ぶ。
- Stale recoveryはscanner起動時にruntime `enqueue()`を`enqueueAttempt`として注入する。
- Process-global registrationや共有可変singletonは使用しない。
- HTTP選択時は既存HTTP self-enqueueを利用する。
- SQS選択時はconsumerとretry producerで同一SQS client / QueueUrlを共有する。
- QueueUrl末尾`.fifo`からStandard / FIFOを判定する。
- FIFO時は既存SQS producerのMessageGroupId / MessageDeduplicationId契約を再利用する。
- Runtime close時はpoll停止後にclientを1回だけdestroyする。
- SendMessage失敗時は成功扱いせず、既存の`infra_failed`安全終端化を維持する。

## SQS infrastructure / IAM

- Source queue retention 4日、long polling 20秒、visibility 90秒。
- DLQ retention 14日、`RedriveAllowPolicy=byQueue`、`MaxReceiveCount`既定5。
- Source / DLQでSQS-managed SSEとTLS denyを有効化する。
- Queue削除・置換時はRetainする。
- API producer roleはsource queueへの`sqs:SendMessage`だけを許可する。
- Worker roleはsource queueへの以下だけを許可する。
  - `sqs:ReceiveMessage`
  - `sqs:DeleteMessage`
  - `sqs:ChangeMessageVisibility`
  - `sqs:SendMessage`
- Wildcard resource、DLQ read、PurgeQueue、queue管理権限を付与しない。
- Customer managed KMS policy例ではWorker retry送信用に`kms:GenerateDataKey`を含める。現行既定はSQS-managed SSE。

## Deployment control plane

- GitHub OIDC deployment roleとCloudFormation execution roleを分離済み。
- OIDC trustは`aud` / `sub`完全一致でstaging Environmentへ限定する。
- Review-only workflowはchange set作成・要約まででexecuteしない。
- Production transportはHTTPのまま。
- 実AWS OIDC bootstrap / SQS change set / transport切替は未実施。

## Issue #131の設計判断

### Target DB

- Amazon RDS for PostgreSQL provisionedを採用する。
- DBはprivate subnet、PubliclyAccessible=false、storage encryption、backup / PITR、deletion protectionを前提とする。
- Production相当ではMulti-AZを採用する。
- Exact PostgreSQL versionはIaC実装Issueで明示固定する。
- 初回cutoverでは既存ID / JSON / timestampのtext表現を維持し、型最適化を別Issueへ分離する。

### ECS topology

- APIとWorkerを別ECS service / task definitionへ分離する。
- API / Workerで別task role、別execution role、別security groupを使用する。
- Schema migrationはone-shot Migrator taskだけが担当する。
- API / Worker startupでDDLを実行しない。

### DB privilege / secret

- PostgreSQL roleを`dojo_api` / `dojo_worker` / `dojo_migrator`へ分離する。
- API / Worker / Migratorで別Secrets Manager secretを使用する。
- Initial authenticationはpassword + TLS verify-fullとする。
- IAM DB authenticationとRDS Proxyは初回対象外とする。
- Secret rotation後はservice redeployを必要とする。

### Database adapter

- Repositoryとdriverの間にasync `DatabaseClient`を導入する。
- `queryOne` / `queryMany` / `execute` / `transaction` / `close`をcontractとする。
- Conditional update結果はnormalized `rowCount`で判定する。
- PostgreSQL transactionは同じclientへ固定する。
- Stale recoveryは`SELECT ... FOR UPDATE`でcurrent rowをlockする。

### Scale gate

- Outbox claim / lease実装前はAPI desired countを1に固定する。
- 複数outbox dispatcherを有効化しない。
- DB cutoverとSQS transport切替を同じchange windowへ混在させない。

### Cutover / rollback

- SQLiteからPostgreSQLへの初回cutoverは短時間maintenance方式とする。
- Write停止後にSQLite backup / export / import / invariant validationを行う。
- Write再開前はSQLite backupへrollbackできる。
- Write再開後はPostgreSQLに新規dataが発生するため、SQLiteへの単純切戻しを禁止する。

## Correctness・セキュリティ境界

- Queue visibility timeoutはdelivery availabilityを担う。
- DB processing leaseはcurrent attemptの実行所有権を担う。
- Attempt idempotency keyとcompletion guardが採点correctnessを担う。
- Exactly-once publish / deliveryへ依存しない。
- Transport retryでgrading attempt / attempt keyを変更しない。
- Submissionとqueue outboxのatomic commitを維持する。
- Queue message / eventへcode / tests / credentials / QueueUrl / ReceiptHandle / raw attempt key / raw SDK errorを記録しない。
- Learnerへqueue / outbox / DLQ / database / delivery count / internal errorを返さない。
- DLQとsubmission `infra_failed`を分離する。
- HTTP producer / consumerを安全なrollback先として維持する。
- API / Worker application roleへDDL権限を与えない。

## Issue #131の成果物

- ADR: `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- Architecture: `docs/architecture/managed-db-ecs-topology.md`
- Migration design: `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- Risk register: `docs/risks/2026-08-01-managed-db-migration-risks.md`
- Cutover draft: `docs/runbooks/2026-08-01-sqlite-postgresql-cutover-draft.md`
- Implementation log: `docs/logs/2026-08-01-issue-131-managed-db-topology-design.md`
- Handoff: `docs/handoff/2026-08-01-issue-131-managed-db-topology-design-handoff.md`

## 現時点の非対応・運用制約

- PostgreSQL driver / adapter実装。
- Versioned migration runner / PostgreSQL schema。
- Repository async移行。
- RDS / Secrets Manager / DB security group IaC。
- Export / import / validation tool。
- ECS task definition / service / cluster。
- Actual AWS accountへのstack create / update / delete。
- Production transport切替。
- VPC endpoint / network path。
- Customer managed KMS key / key policy本体。
- DLQ replay / purge API・UI。
- Queue / outbox metrics backend、dashboard、alert。
- Outbox claim / lease。
- Durable application retry scheduling。
- Retained queue inventory / cleanup自動化。
- RDS Proxy / IAM DB authentication。

## 優先順位（直近）

1. Issue #131のdocs review / merge。
2. DB adapterとSQLite / PostgreSQL dual-provider contract test基盤。
3. Versioned migration runnerとPostgreSQL互換schema。
4. Repositoryのasync adapter移行。
5. Outbox claim / leaseと複数API instance安全化。
6. RDS PostgreSQL / Secrets Manager / network IaC。
7. SQLite export / PostgreSQL import / validation tool。
8. API / Worker / Migrator ECS wiring。
9. Staging cutover rehearsal。
10. 別承認でSQS transport切替。

## Branch cleanup

- PR #130は2026-08-01（日本時間）にmerge済み。
- PR #130のhead branch`feat/worker-retry-queue-runtime`は削除確認対象。
- Issue #131 branchは`docs/managed-db-topology-design`。
- Issue #131 merge後にhead branchを削除する。

## 参照先

- Issue #131: `https://github.com/mizzz-ivr/ai-code-dojo/issues/131`
- PR #130: `https://github.com/mizzz-ivr/ai-code-dojo/pull/130`
- ADR: `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- Managed DB topology: `docs/architecture/managed-db-ecs-topology.md`
- Migration design: `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- Risk register: `docs/risks/2026-08-01-managed-db-migration-risks.md`
- Cutover draft: `docs/runbooks/2026-08-01-sqlite-postgresql-cutover-draft.md`
