# active-issues（正本）

最終更新: 2026-08-01（Issue #131 Managed DB / ECS topology設計中）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #131 Managed DB移行とAPI / Worker実行トポロジーを設計する

- 優先度: P2
- 状態: Open / In Progress
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/131`
- Linear: 無料Issue上限により作成不可。GitHub Issue / Repository docs / Notionを管理正本とする。
- Branch: `docs/managed-db-topology-design`
- Scope: docs-only
- 目的: SQLiteからManaged PostgreSQLへの移行方針とAPI / Worker / MigratorのECS実行トポロジーを確定し、後続実装を安全に分割する。

#### 背景

- 現行DBは固定SQLite `.data/app.db`。
- API / Workerを別ECS taskへ分離するとDB fileを共有できない。
- API / Workerを同一taskへ同居させるとtask roleが共通になり、producer / Worker最小権限を維持できない。
- Repository層は`DatabaseSync`、`?` placeholder、`BEGIN IMMEDIATE`、`PRAGMA`、`write.changes`へ直接依存する。
- ECS wiring前にdriver、transaction、migration ownership、secret、network、cutoverを確定する必要がある。

#### 決定事項

- Target DBはAmazon RDS for PostgreSQL provisioned。
- API / Workerは別ECS service / task definition。
- Schema migrationはone-shot Migrator task。
- PostgreSQL roleをAPI / Worker / Migratorで分離。
- Secrets Manager password + TLS verify-fullを初期方式とする。
- IAM DB authenticationとRDS Proxyは初回対象外。
- Repositoryとdriverの間にasync `DatabaseClient`を導入する。
- 初回cutoverではID / JSON / timestampのtext表現を維持する。
- Stale recoveryはPostgreSQL row lockを使用する。
- Outbox claim / lease前はAPI desired countを1に固定する。
- Cutoverは短時間maintenance方式。
- Write再開後のSQLite単純切戻しを禁止する。

#### 対象

- SQLite固有依存のファイル単位棚卸し
- RDS PostgreSQL採用ADR
- API / Worker / Migrator topology
- AWS task role / execution role / PostgreSQL role境界
- Secret / TLS / security group / connection pool設計
- Database adapter contract
- Transactional outbox / lease / fencing / completion guard維持条件
- Export / import / validation / cutover / rollback設計
- Follow-up Issue分割
- ADR / architecture / report / risk / runbook / log / prompt / handoff
- Canonical docs / Notion同期

#### 非対象

- PostgreSQL driver導入
- Repository code変更
- PostgreSQL schema implementation
- Actual RDS / ECS / Secrets Manager resource
- Actual data migration
- Production transport切替
- SQS切替
- RDS Proxy
- IAM DB authentication
- JSONB / timestamptz / uuid最適化

#### 完了条件

- RDS PostgreSQL採用理由と不採用案をADRへ記載する。
- API / Worker / Migratorのtask / IAM / DB role境界を確定する。
- SQLite固有処理とPostgreSQL差分をファイル単位で整理する。
- Async DatabaseClient contractを定義する。
- Submission / outbox atomicity、lease、attempt fencing、completion guardの維持方法を定義する。
- Outbox multiple dispatcherのscale gateを定義する。
- Secret、TLS、network、pool、migration ownershipを定義する。
- Short maintenance cutoverとrollback checkpointを定義する。
- Follow-up実装Issueを依存順付きで分割する。
- Repository正本とNotionを同期する。
- Docs validationが成功する。

#### 成果物

- `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- `docs/architecture/managed-db-ecs-topology.md`
- `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- `docs/risks/2026-08-01-managed-db-migration-risks.md`
- `docs/runbooks/2026-08-01-sqlite-postgresql-cutover-draft.md`
- `docs/logs/2026-08-01-issue-131-managed-db-topology-design.md`
- `docs/handoff/2026-08-01-issue-131-managed-db-topology-design-handoff.md`

## Blocked Issue

### ECS task definitionへのrole関連付けとruntime environment注入

- 状態: Blocked / Implementation dependencies required
- Design blocker: Issue #131で解消対象。
- Implementation blocker:
  - DB adapter
  - PostgreSQL schema / migration runner
  - Repository port
  - Outbox claim / lease
  - RDS / secret / network IaC
  - Data migration tool / rehearsal
- 再開条件: 上記依存Issueが完了し、staging PostgreSQL cutover rehearsalが成功すること。

## Recently Completed

### #129 / PR #130（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-08-01（日本時間）
- 反映内容: Worker application retry / stale recoveryを選択中のHTTP / SQS queue runtimeへ統合し、runtime `enqueue()`明示注入、SQS client共有、Worker SendMessage最小権限を実装した。

### #127 / PR #128（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-31（日本時間）
- 反映内容: staging GitHub OIDC trust、deployment role、CloudFormation execution role、review-only change set workflow、static validationを整備した。

### #125 / PR #126（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-30（日本時間）
- 反映内容: SQS source queue、DLQ、RedrivePolicy、TLS deny、workload IAM role、static validator、runbookをCloudFormation IaCとして整備した。

### #123 / PR #124（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
- 反映内容: Worker SQS consumer、long polling、visibility延長、安全なack、DLQ redrive前提の非削除契約を実装した。

### #121 / PR #122（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-28（日本時間）
- 反映内容: API HTTP / SQS transport選択、SQS client lifecycle、legacy / outbox共通enqueueを実装した。

### #119 / PR #120（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-27
- 反映内容: Standard / FIFO対応SQS producer adapter、構造化event、outbox integrationを実装した。

### #117 / PR #118（完了済み）

- 優先度: P2
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-26
- 反映内容: Submissionとqueue publish intentのatomic保存、pending outbox dispatcherを実装した。

### #115 / PR #116（完了済み）

- 優先度: P1
- 状態: Closed / Merged / Completed
- 完了日: 2026-07-25
- 反映内容: Application retryへexponential backoff + full jitterを追加した。

## Follow-up Issue Candidates

依存順:

1. DB adapterとSQLite / PostgreSQL dual-provider contract test基盤（P2）
2. Versioned migration runnerとPostgreSQL互換schema（P2）
3. Submission / challenge / outbox repositoryのasync adapter移行（P2）
4. Outbox claim / leaseと複数API instance安全化（P2）
5. RDS PostgreSQL / Secrets Manager / security group IaC（P2）
6. SQLite export / PostgreSQL import / validation tool（P2）
7. API / Worker / Migrator ECS task definition / service wiring（P2）
8. Staging cutover rehearsal / rollback drill（P2）
9. DLQ replay / purge運用（P2）
10. Queue / outbox metrics backend / dashboard / alert（P2）
11. Durable application retry scheduling（P2）

## Scale gate

- Outbox claim / lease完了前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
- Staging rehearsal前にproduction相当cutoverを行わない。

## Branch Cleanup

- PR #130のhead branch`feat/worker-retry-queue-runtime`は削除確認対象。
- Issue #131 branchは`docs/managed-db-topology-design`。
- Issue #131 merge後にhead branchを削除する。
