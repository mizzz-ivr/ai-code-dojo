# adr

最終更新: 2026-08-01

## 目的
このディレクトリの保管対象を定義し、情報の散逸を防ぐ。

## 保管ルール
- ファイル名は `YYYY-MM-DD-<topic>.md` を基本とする。
- 先頭に「目的 / 背景 / 決定事項 / 未確定事項（必要時）」を記載する。
- 正本と重複する説明は避け、必要時は正本リンクを貼る。

## ADR一覧

- `2026-08-01-managed-postgresql-ecs-service-topology.md`
  - RDS for PostgreSQLへの移行、API / Worker別ECS service、Migrator task、DB role / secret / TLS / cutover境界
  - 関連Issue: #131
  - 詳細設計: `docs/architecture/managed-db-ecs-topology.md`
  - 移行計画: `docs/reports/2026-08-01-sqlite-postgresql-migration-design.md`
- `2026-07-23-queue-delivery-and-db-fencing-boundary.md`
  - queue delivery / ack / visibility / DLQとDB processing lease / attempt fencing / completion guardの責務境界
  - 関連Issue: #109
  - 詳細設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- `2026-07-22-stale-running-lease-recovery.md`
  - stale `running` submissionのlease / heartbeat / attempt fencing / recovery方針
  - 関連Issue: #101
  - 詳細設計: `docs/reports/2026-07-22-stale-running-lease-recovery-design.md`
