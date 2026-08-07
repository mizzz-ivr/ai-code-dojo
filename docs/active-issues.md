# active-issues（正本）

最終更新: 2026-08-06（Issue #137 / PR #138をレビュー可能状態へ整備）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #137 実PostgreSQLテスト環境・pg driver・migration executorを導入する

- 優先度: P2
- 状態: Open / Ready for review
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/137`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/138`
- Branch: `feat/postgresql-migration-executor`
- Linear: 無料Issue上限により作成不可。GitHub Issue / Repository docs / Notionを管理正本とする。

#### 目的

Versioned migration manifestを実PostgreSQL上で適用・検証し、Repositoryの段階移行前にschema・transaction・drift検出を実DBで保証する。

#### 対象

- `pg` 8.22.0固定
- PostgreSQL 18.4固定
- PostgreSQL接続設定のfail-closed validation
- URL query parameter / fragment拒否
- TLS `verify-full`既定
- Statement / lock timeoutの有限化
- PostgreSQL migration plan / status / apply
- 専用connectionとsearch path固定
- 非待機advisory lockによる同時Migrator拒否
- Migration単位transaction
- 初回history tableをMigration 1 transactionへ包含
- DDLとhistory INSERTのatomicity
- Rollback / unlock失敗時のconnection破棄
- Safe CLI failure JSON
- GitHub Actions PostgreSQL service container
- 実PostgreSQL DatabaseClient contract test
- 実PostgreSQL migration integration test
- Architecture / runbook / log / prompt / handoff / canonical docs

#### 非対象

- Existing RepositoryのPostgreSQL切替
- Production runtime変更
- RDS / ECS / Secrets Manager resource
- SQLiteからPostgreSQLへのdata migration
- Production cutover
- JSONB / timestamptz / UUID最適化
- Application roleへのDDL権限付与

#### 完了条件

- PostgreSQL 18.4でmigration 1〜3を適用できる。
- 再実行をno-opにする。
- Migration失敗時にpartial schema / historyを残さない。
- 初回Migration 1失敗時にbootstrap history tableを残さない。
- Checksum driftと同時Migratorを適用前に拒否する。
- 実PostgreSQL上でDatabaseClient共通contractを満たす。
- URLからTLS設定を上書きできない。
- SQL待機とlock待機を有限化する。
- Unlock / rollback失敗connectionをpoolへ戻さない。
- CLIへSQL、parameters、credentials、submitted code、hidden tests、raw causeを出力しない。
- Production runtimeをSQLite / HTTPのまま維持する。
- 全品質ゲートが成功する。

#### 現在の確認結果

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- PostgreSQL 18.4 service initialization: Success
- 実PostgreSQL integration test: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success
- PR: Ready for review / mergeable
- Inline review thread: 0件
- 自動Codex review: 利用上限のため未実行
- Manual self-review: 完了、5件の安全改善を反映済み

## Blocked Issue

### ECS task definition / service wiring

- 状態: Blocked / Implementation dependencies required
- 再開条件:
  1. DB adapter contract: PR #134で完了
  2. Versioned schema / SQLite runner: PR #136で完了
  3. 実PostgreSQL test / executor: Issue #137でレビュー中
  4. Repository async移行
  5. Outbox claim / lease
  6. RDS / secret / network IaC
  7. Data migration tool / staging rehearsal

## Recently Completed

### #135 / PR #136（完了済み）

- 完了日: 2026-08-06（日本時間）
- 反映内容: Versioned migration manifest、provider別schema、checksum / drift検出、SQLite runner、有限busy timeoutを実装した。

### #133 / PR #134（完了済み）

- 完了日: 2026-08-05（日本時間）
- 反映内容: Async DatabaseClient contract、SQLite adapter、PostgreSQL provider境界、共通contract test、SQLite transaction中の外側操作隔離を実装した。

### #131 / PR #132（完了済み）

- 完了日: 2026-08-05（日本時間）
- 反映内容: RDS PostgreSQL採用、API / Worker / Migrator分離、DB role / secret / network、cutover / rollback、後続Issue依存順を設計した。

### #129 / PR #130（完了済み）

- 完了日: 2026-08-01（日本時間）
- 反映内容: Worker retry / stale recoveryを選択中queue runtimeへ統合した。

## Follow-up Issue Candidates

依存順:

1. Challenge Repositoryのasync DatabaseClient移行（P2）
2. Submission read / simple writeのasync移行（P2）
3. Submission processing lease / attempt fencingのasync移行（P2）
4. Submission + queue outbox atomic transactionのasync移行（P2）
5. API / Worker composition rootのprovider切替（P2）
6. Outbox claim / leaseと複数API instance安全化（P2）
7. RDS PostgreSQL / Secrets Manager / security group IaC（P2）
8. SQLite export / PostgreSQL import / validation tool（P2）
9. API / Worker / Migrator ECS wiring（P2）
10. Staging cutover rehearsal / rollback drill（P2）

## Scale gate

- Outbox claim / lease完了前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Repository実PostgreSQL contract test前にproduction DBへ切り替えない。
- Checksum driftを手動更新や自動修復で回避しない。
- 適用済みmigrationは変更せず、新versionを追加する。
- 同時Migratorを待機・並行実行させない。
- Application roleへDDL権限を付与しない。
- Connection URL query parameterでTLS設定を上書きさせない。
- Raw database errorを公開CLI logへ出力しない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
