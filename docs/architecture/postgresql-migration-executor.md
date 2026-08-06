# PostgreSQL Migration Executor Architecture

最終更新: 2026-08-06

## 目的

Versioned migration manifestを実PostgreSQLへ安全に適用し、将来のone-shot Migrator taskで再利用できる実行境界を定義する。

## 適用範囲

- PostgreSQL 18.4
- `pg` 8.22.0
- Schema migrationのplan / status / apply
- CI service container上の実DB検証

ProductionのAPI / Worker Repository切替、RDS、ECS、data migrationは対象外。

## Component

### PostgreSQL config

`apps/api/src/db/postgresql/postgresql-config.mjs`

責務:

- 接続URLの構文・必須要素検証
- SSL modeのfail-closed validation
- schema identifier検証
- pool / timeout境界値検証
- `pg.Pool`生成

既定値:

- SSL: `verify-full`
- Schema: `public`
- Pool max: 4
- Connection timeout: 5000ms
- Idle timeout: 1000ms

`POSTGRESQL_SSL_MODE=disable`はlocalhostまたは`NODE_ENV=test`に限定する。

### Migration executor

`apps/api/src/db/migrations/postgresql-migration-runner.mjs`

責務:

1. 専用pool connectionを取得する。
2. Search pathを検証済みschemaへ固定する。
3. `pg_try_advisory_lock`でmigration lockを非待機取得する。
4. Applied historyを読み、version / name / provider / checksum driftを検証する。
5. 未適用migrationを昇順で実行する。
6. 各migrationのDDLとhistory INSERTを同一transactionでcommitする。
7. 失敗時にrollbackする。
8. Advisory lockを解放しconnectionを返却する。

## Concurrency model

Migrationは同一databaseで同時実行しない。

- Lockはsession-level advisory lock。
- Lock取得には`pg_try_advisory_lock`を使う。
- 別Migratorがlock保持中の場合は待機せず`PostgresqlMigrationLockError`を返す。
- Operator / deployment orchestratorが既存Migratorの状態を確認して再実行する。
- Connection切断時はPostgreSQLがsession lockを解放する。

非待機にする理由:

- Deploymentが無期限に停止することを防ぐ。
- 二重起動を明示的な障害として検知する。
- Migrator task数を1に固定する運用と整合する。

## Transaction model

Migration単位で以下を同一transactionに含める。

- Provider別schema steps
- `schema_migrations` history INSERT

失敗時:

- DDLとhistoryをrollbackする。
- Rollback失敗は元migration errorを上書きしない。
- Partial schemaを成功扱いしない。

Migration tableの初回作成はadvisory lock取得後に行う。Migration 1適用前の共通bootstrap tableとして扱う。

## Plan / status model

Plan / statusはschemaを変更しない。

- `schema_migrations`が存在しない場合はappliedを空として扱う。
- Applied historyがある場合は全rowを昇順で検証する。
- Pendingにはversion / name / provider / checksumだけを保持する。
- CLI出力はversion / nameへ制限する。

## Security boundary

- Production接続はTLS `verify-full`を既定とする。
- Connection URL、password、SQL parametersをログへ出力しない。
- Submitted code、hidden tests、message payloadをmigration logへ出力しない。
- Migrator roleだけがDDL権限を持つ。
- API / Worker application roleへDDL権限を付与しない。
- Search pathは検証済みlowercase identifierへ固定する。
- URL内のquery parameterでTLS設定を上書きする運用は採用しない。

## CI topology

GitHub Actionsのintegration jobでPostgreSQL 18.4 service containerを起動する。

- Database: `dojo_test`
- CI専用credential
- Localhost接続
- SSL disabledはtest環境だけ許可
- Testごとに一意schemaを作成
- Test終了時にschemaをCASCADE削除

CIで検証する内容:

- Server version固定
- DatabaseClient共通contract
- Migration 1〜3適用
- Rerun no-op
- CHECK / FK / UNIQUE constraint
- Failure rollback
- Checksum drift拒否
- Advisory lock競合拒否

## Failure behavior

### 接続設定不正

Pool生成前に拒否する。

### Connection失敗

`pg` errorとして呼び出し元へ返す。Credentialやconnection stringを独自ログへ展開しない。

### Migration lock競合

`PostgresqlMigrationLockError`として即時失敗する。

### Drift

DDL実行前にfail-closedで拒否する。History rowを自動修復しない。

### Migration SQL失敗

対象migrationをrollbackし、version / nameだけを含む一般化errorで返す。Original errorは`cause`へ保持するが、CLIでraw dumpしない。

## Production wiring前のgate

- RDS exact engine versionをIaCで固定する。
- Migrator専用secret / role / security groupを作成する。
- TLS CA bundleとhostname verificationをstagingで確認する。
- One-shot taskが正常終了するまでAPI / Worker deploymentを開始しない。
- Repository async移行とdata migration rehearsalを完了する。
- DB cutoverとSQS transport切替を同時に実施しない。
