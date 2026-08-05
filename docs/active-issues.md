# active-issues（正本）

最終更新: 2026-08-05（Issue #135 / PR #136を実装中）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #135 Versioned migration runnerとPostgreSQL互換schemaを導入する

- 優先度: P2
- 状態: Open / In Progress
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/135`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/136`
- Branch: `feat/versioned-migration-runner`
- Linear: 無料Issue上限により作成不可。GitHub Issue / Repository docs / Notionを管理正本とする。

#### 目的

既存SQLite runtimeを維持したまま、順序保証・checksum・atomicity・drift検出を備えたversioned migration runnerとPostgreSQL互換schemaを導入する。

#### 対象

- Version / name / provider / checksum contract
- `schema_migrations` history table
- 未適用migrationの昇順適用
- Version gap / name drift / provider mismatch / checksum driftのfail-closed validation
- SQLite migration単位transaction
- Existing untracked SQLite schemaのbaseline化
- SQLite / PostgreSQL provider別schema
- `core_schema`
- `submission_attempt_and_lease`
- `queue_outbox`
- `db:migrate --plan` / `--status`
- SQLite接続の有限busy timeout
- Unit / integration / schema / infra / build validation
- Architecture / runbook / log / prompt / handoff / canonical docs

#### 非対象

- `pg` packageと実PostgreSQL接続
- PostgreSQL migration executor
- Repository全体のasync移行
- RDS / ECS / Secrets Manager resource
- Data migration / production切替
- Destructive down migration
- JSONB / timestamptz / uuid最適化

#### 完了条件

- Migration versionを1からの連番として検証する。
- SQLite / PostgreSQL両providerの定義欠落を拒否する。
- Applied migrationのchecksum driftを適用前に拒否する。
- Schema変更とhistory insertを同じtransactionで処理する。
- Migration失敗時にpartial schema / historyを残さない。
- 再実行をno-opにする。
- Existing SQLite schemaからattempt / lease / outbox schemaへ移行できる。
- PostgreSQL schemaへSQLite固有構文を混入させない。
- CLIへSQL、data、credentialsを出力しない。
- API / Worker間の短時間SQLite write lock競合を有限待機で吸収する。
- Production runtimeをSQLite / HTTPのまま維持する。
- 全品質ゲートが成功する。

#### 現在の確認結果

- 初回品質ゲート: 全成功
- Docs追加後integration: stale recoveryで短時間SQLite write lock競合を検出
- 修正: Runtime / plan / statusの全SQLite接続へ5秒の`busy_timeout`を設定
- 修正後Unit test: Success
- 修正後Integration test: Success
- 修正後Lint: Success
- 修正後Typecheck: Success
- 修正後Schema validation: Success
- 修正後Infra validation: Success
- 修正後Docs validation: Success
- 最新headのBuildを含む最終品質ゲートを確認中

## Blocked Issue

### ECS task definition / service wiring

- 状態: Blocked / Implementation dependencies required
- 再開条件:
  1. DB adapter contract: PR #134で完了
  2. PostgreSQL schema / migration runner: Issue #135で進行中
  3. 実PostgreSQL test environment / executor
  4. Repository async移行
  5. Outbox claim / lease
  6. RDS / secret / network IaC
  7. Data migration tool / staging rehearsal

## Recently Completed

### #133 / PR #134（完了済み）

- 完了日: 2026-08-05（日本時間）
- 反映内容: async DatabaseClient contract、SQLite adapter、PostgreSQL provider境界、共通contract test、SQLite transaction中の外側操作隔離を実装した。

### #131 / PR #132（完了済み）

- 完了日: 2026-08-05（日本時間）
- 反映内容: RDS PostgreSQL採用、API / Worker / Migrator分離、DB role / secret / network、cutover / rollback、後続Issue依存順を設計した。

### #129 / PR #130（完了済み）

- 完了日: 2026-08-01（日本時間）
- 反映内容: Worker retry / stale recoveryを選択中queue runtimeへ統合した。

### #127 / PR #128（完了済み）

- 完了日: 2026-07-31（日本時間）
- 反映内容: staging GitHub OIDCとreview-only change set workflowを整備した。

### #125 / PR #126（完了済み）

- 完了日: 2026-07-30（日本時間）
- 反映内容: SQS source queue / DLQ / workload IAM roleのCloudFormation IaCを整備した。

## Follow-up Issue Candidates

依存順:

1. 実PostgreSQL test environment / `pg` driver / migration executor（P2）
2. Submission / challenge / outbox repositoryのasync adapter移行（P2）
3. Outbox claim / leaseと複数API instance安全化（P2）
4. RDS PostgreSQL / Secrets Manager / security group IaC（P2）
5. SQLite export / PostgreSQL import / validation tool（P2）
6. API / Worker / Migrator ECS wiring（P2）
7. Staging cutover rehearsal / rollback drill（P2）
8. DLQ replay / purge運用（P2）
9. Queue / outbox metrics / alert（P2）

## Scale gate

- Outbox claim / lease完了前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- 実PostgreSQL contract test前にproduction DBへ切り替えない。
- Checksum driftを手動更新や自動修復で回避しない。
- 適用済みmigrationは変更せず、新versionを追加する。
- SQLite busy timeout後のlock errorを成功扱いしない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
