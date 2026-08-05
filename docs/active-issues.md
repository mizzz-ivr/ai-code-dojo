# active-issues（正本）

最終更新: 2026-08-05（Issue #133 / PR #134を実装中）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #133 非同期DB adapterとSQLite・PostgreSQL共通契約テストを導入する

- 優先度: P2
- 状態: Open / In Progress
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/133`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/134`
- Branch: `feat/async-db-adapter-contract`
- Linear: 無料Issue上限により作成不可。GitHub Issue / Repository docs / Notionを管理正本とする。

#### 目的

既存SQLite runtimeを維持したまま、Managed PostgreSQL移行でprovider間に共通化する非同期DB contractと再利用可能なcontract testを追加する。

#### 対象

- async `DatabaseClient`の`query` / `execute` / `transaction` / `close`
- SQLite `DatabaseSync` adapter
- PostgreSQL pool / connection注入adapter境界
- `rowCount` / `lastInsertId` / row objectの正規化
- PostgreSQL placeholder変換
- provider selectionのfail-closed validation
- SQLite実memory DB / PostgreSQL fake poolの共通contract test
- commit / rollback / nested transaction / close境界
- Architecture / runbook / log / prompt / handoff / canonical docs

#### 非対象

- `pg` package導入
- 実PostgreSQL接続
- Repository全体のadapter移行
- Versioned migration runner / PostgreSQL schema
- RDS / ECS / Secrets Manager resource
- Data migration / production切替

#### 完了条件

- Provider固有APIを共通contract外へ漏らさない。
- SQLite / PostgreSQLのquery rowをplain objectへ正規化する。
- Conditional updateに利用できる`rowCount`を共通化する。
- Transactionが同一database / connectionでcommit・rollbackされる。
- Nested transactionとclose後操作を拒否する。
- 未対応providerをfail-closedで拒否する。
- 既存Repositoryとproduction runtimeを変更しない。
- 全品質ゲートが成功する。

#### 現在の確認結果

- Initial lint: Success
- Initial typecheck: Success
- Initial integration test: Success
- Initial schema validation: Success
- Initial infra validation: Success
- Initial unit test: SQLite null prototype row差異を検出
- 修正: SQLite adapterでplain objectへ正規化
- Final CI: 再実行中

## Blocked Issue

### ECS task definition / service wiring

- 状態: Blocked / Implementation dependencies required
- 再開条件:
  1. DB adapter contract
  2. PostgreSQL schema / migration runner
  3. Repository async移行
  4. Outbox claim / lease
  5. RDS / secret / network IaC
  6. Data migration tool / staging rehearsal

## Recently Completed

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

1. Versioned migration runnerとPostgreSQL互換schema（P2）
2. 実PostgreSQL test environment / driver（P2）
3. Submission / challenge / outbox repositoryのasync adapter移行（P2）
4. Outbox claim / leaseと複数API instance安全化（P2）
5. RDS PostgreSQL / Secrets Manager / security group IaC（P2）
6. SQLite export / PostgreSQL import / validation tool（P2）
7. API / Worker / Migrator ECS wiring（P2）
8. Staging cutover rehearsal / rollback drill（P2）
9. DLQ replay / purge運用（P2）
10. Queue / outbox metrics / alert（P2）

## Scale gate

- Outbox claim / lease完了前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- 実PostgreSQL contract test前にproduction DBへ切り替えない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
