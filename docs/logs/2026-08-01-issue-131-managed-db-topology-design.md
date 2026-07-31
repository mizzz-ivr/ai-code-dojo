# Issue #131 Managed DB / ECS topology設計ログ

日付: 2026-08-01

## 背景

PR #130マージ後の正本優先順位に従い、Managed DB移行とAPI / Worker実行トポロジーのdocs-only設計を開始した。

Linear Issue作成を試行したが、workspaceの無料Issue上限により失敗した。ユーザー指示に従いGitHub Issue #131を管理正本として作成した。

## 調査対象

- `apps/api/src/db/database.mjs`
- `apps/api/src/repositories/submission-repository.mjs`
- `apps/api/src/repositories/submission-outbox-repository.mjs`
- `apps/api/src/repositories/queue-outbox-repository.mjs`
- `apps/api/src/repositories/stale-submission-recovery-repository.mjs`
- `apps/api/src/repositories/admin-challenge-repository.mjs`
- `docs/current-status.md`
- `docs/active-issues.md`
- `docs/architecture/system-overview.md`

## 確認したSQLite依存

- `node:sqlite` / `DatabaseSync`
- `.data/app.db`固定path
- Sync `.prepare().get/all/run`
- `?` placeholder
- `write.changes`
- `PRAGMA table_info`
- Startup DDL / legacy import
- `BEGIN IMMEDIATE`
- Module-level singleton connection

## 設計判断

- Target DBはAmazon RDS for PostgreSQL provisionedとする。
- API / Workerは別ECS service / task definitionへ分離する。
- Schema migrationはone-shot migrator taskだけが実行する。
- API / Worker / MigratorでPostgreSQL roleとsecretを分ける。
- Initial credentialはSecrets Manager password + TLS verify-fullとする。
- IAM DB authとRDS Proxyは初回対象外とする。
- Repositoryとdriverの間にasync DatabaseClientを導入する。
- 初回cutoverではID / JSON / timestampの値表現を維持し、type最適化を混在させない。
- Stale recoveryはPostgreSQL row lockを使用する。
- Outbox claim / lease前はAPI desired countを1に固定する。
- Cutoverは短時間maintenance方式とし、zero downtimeを目標にしない。
- Write再開後のSQLite単純切戻しを禁止する。

## 作成文書

- ADR: `docs/adr/2026-08-01-managed-postgresql-ecs-service-topology.md`
- Architecture: `docs/architecture/managed-db-ecs-topology.md`
- Migration design: `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- Risk register: `docs/risks/2026-08-01-managed-db-migration-risks.md`
- Cutover draft: `docs/runbooks/2026-08-01-sqlite-postgresql-cutover-draft.md`

## AWS公式情報の確認

- ECS task roleはtask内applicationへ権限を提供する。
- Task execution roleはECS agentによるimage / log / secret取得を担当する。
- ECS secret environment injectionはtask開始時に反映され、rotation後のrunning taskへ自動反映されない。
- RDS for PostgreSQLはVPC、backup、PITR、Multi-AZ、TLS接続を提供する。
- RDS Proxyはconnection pooling / failover補助を提供するが、初回MVPの必須要件ではない。
- PostgreSQL row lockingは`SELECT ... FOR UPDATE`を利用できる。

## 非対象

- Driver / repository code変更
- PostgreSQL schema implementation
- Actual AWS resource
- Actual data migration
- Production transport切替

## 管理

- GitHub Issue: #131
- Branch: `docs/managed-db-topology-design`
- Linear: 無料Issue上限により作成不可
- Notion: 同期対象
