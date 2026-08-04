# Issue #131 Managed DB / ECS topology handoff

最終更新: 2026-08-01

## 状態

- GitHub Issue: #131
- Branch: `docs/managed-db-topology-design`
- Linear: 無料Issue上限により作成不可
- Scope: docs-only
- Production DB: SQLiteのまま
- Production transport: HTTPのまま
- Actual AWS operation: 未実施

## 決定概要

- Target DB: Amazon RDS for PostgreSQL provisioned
- API / Worker: 別ECS service / task definition
- Migration: one-shot migrator task
- PostgreSQL role: API / Worker / Migratorで分離
- Credential: Secrets Manager passwordを初期採用
- TLS: verify-full相当
- IAM DB auth: 初回対象外
- RDS Proxy: 初回対象外
- DB adapter: async `DatabaseClient`
- Initial schema: Existing text / integer表現を維持
- Cutover: 短時間maintenance
- Rollback: Write再開後のSQLite単純切戻し禁止

## 主要文書

- `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- `docs/architecture/managed-db-ecs-topology.md`
- `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- `docs/risks/2026-08-01-managed-db-migration-risks.md`
- `docs/runbooks/2026-08-01-sqlite-postgresql-cutover-draft.md`

## Correctness不変条件

- Submission / outbox atomic commit
- Conditional claim / heartbeat / completion
- Attempt idempotency key fencing
- Completion guard
- Processing lease ownership
- Stale recoveryのcurrent state再検証
- Exactly-once delivery非依存
- Hidden tests非公開
- APIで提出コードを直接実行しない

## 実装順

1. DB adapter / dual-provider contract tests
2. Versioned migration runner / PostgreSQL schema
3. Repository async adapter移行
4. Outbox claim / lease
5. RDS / secret / network IaC
6. Export / import / validation tool
7. API / Worker / Migrator ECS wiring
8. Staging cutover rehearsal
9. Production相当cutover
10. 別承認でSQS transport切替

## Reviewで見る点

- RDS PostgreSQL採用理由がMVPに対して妥当か
- API / Worker / MigratorのIAM / DB role境界が明確か
- SQLite固有依存の棚卸しに漏れがないか
- `BEGIN IMMEDIATE`からPostgreSQL row lockへの置換方針が安全か
- Outbox multiple dispatcherを先に許可していないか
- Secret rotation時のtask redeployが明記されているか
- Cutoverの不可逆checkpointが明確か
- Driver変更とschema type最適化が分離されているか

## 未確定

- PostgreSQL exact version
- Staging Multi-AZ
- Secret rotation frequency
- Pool max / timeout
- RDS Proxy導入threshold
- Cutover日時 / 許容停止時間

これらは後続IaC / adapter / cutover Issueで決定する。

## Merge後

- Issue #131をcloseする。
- Branchを削除する。
- Actual DB / ECS resourceを作成しない。
- 次IssueとしてDB adapter / dual-provider contract testを起票する。
- Existing SQLite / HTTP runtimeを維持する。
