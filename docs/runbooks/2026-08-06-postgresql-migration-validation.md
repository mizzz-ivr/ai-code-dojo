# PostgreSQL Migration Validation Runbook

最終更新: 2026-08-06

## 目的

実PostgreSQLに対するmigrationのplan、status、apply、異常時対応を安全に実施する。

## 前提

- 現行Production runtimeはSQLite / HTTP。
- この手順だけでProduction DBをPostgreSQLへ切り替えない。
- Production相当環境ではMigrator専用role / secretを使用する。
- API / Worker application roleへDDL権限を付与しない。
- Connection URL、SQL、parameters、submitted code、hidden testsをログへ残さない。

## 必須環境変数

```bash
DB_PROVIDER=postgresql
POSTGRESQL_DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>
POSTGRESQL_SCHEMA=public
POSTGRESQL_SSL_MODE=verify-full
```

`POSTGRESQL_DATABASE_URL`へquery parameterやfragmentを含めない。TLS設定は`POSTGRESQL_SSL_MODE`で管理する。

Optional:

```bash
POSTGRESQL_POOL_MAX=4
POSTGRESQL_CONNECTION_TIMEOUT_MS=5000
POSTGRESQL_IDLE_TIMEOUT_MS=1000
POSTGRESQL_STATEMENT_TIMEOUT_MS=60000
POSTGRESQL_LOCK_TIMEOUT_MS=5000
```

`POSTGRESQL_SSL_MODE=disable`はlocalhostまたはtest環境だけで使用する。

## 事前確認

1. Maintenance windowまたはwrite停止条件を確認する。
2. Target database / schema / userが正しいことを確認する。
3. Migrator userに必要なDDL権限があることを確認する。
4. Application userにDDL権限がないことを確認する。
5. Backup / restore pointを確認する。
6. 別Migrator taskが実行中でないことを確認する。
7. Statement / lock timeoutが対象migrationの規模に対して妥当であることを確認する。
8. `pnpm install --frozen-lockfile`を実行する。

## Plan

```bash
DB_PROVIDER=postgresql pnpm db:migrate --plan
```

確認項目:

- `provider`が`postgresql`。
- Applied versionが1から連続している。
- Pendingが意図したversion / nameだけである。
- Checksum drift / provider mismatch / history gapが発生していない。
- Outputに接続URL、SQL、parameter、dataが含まれていない。

Planは`schema_migrations`を作成せず、schemaを変更しない。

## Status

```bash
DB_PROVIDER=postgresql pnpm db:migrate --status
```

Statusもread-onlyで実行する。

## Apply

```bash
DB_PROVIDER=postgresql pnpm db:migrate
```

正常時:

- Exit code 0。
- `pending`が空。
- Applied version / nameが期待値と一致。
- SQLやcredentialがstdout / stderrへ出ていない。

初回Migration 1では`schema_migrations`作成も同じtransactionへ含まれる。Migration 1失敗時はhistory tableだけを残さない。

## 失敗時のCLI出力

失敗時はallowlist fieldだけをJSON出力する。

```json
{
  "event": "db.migration.failed",
  "provider": "postgresql",
  "mode": "apply",
  "errorType": "Error"
}
```

出力しない情報:

- Error message
- Stack trace
- Error cause
- Connection URL / host / password
- SQL / parameters
- Submitted code / hidden tests

詳細調査は権限を制限した内部ログとdatabase metadataで行い、公開Issueへraw errorを貼らない。

## 適用後確認

```bash
DB_PROVIDER=postgresql pnpm db:migrate --status
```

安全なmetadata queryに限定して確認する。

```sql
SELECT version, name, provider, applied_at
FROM schema_migrations
ORDER BY version;
```

期待値:

1. `core_schema`
2. `submission_attempt_and_lease`
3. `queue_outbox`

## CIでの再現

GitHub Actions integration jobはPostgreSQL 18.4 service containerを使用する。

Local test例:

```bash
export NODE_ENV=test
export POSTGRESQL_TEST_DATABASE_URL=postgresql://dojo:dojo_test_password@127.0.0.1:5432/dojo_test
export POSTGRESQL_SSL_MODE=disable
pnpm test:integration
```

CI / local test credentialをProductionへ流用しない。

## Error対応

### `PostgresqlMigrationLockError`

別Migratorがsession-level advisory lockを保持している。

対応:

1. 再実行を連打しない。
2. Deployment / ECS task / CI jobの実行状況を確認する。
3. 既存Migratorの終了または異常停止を確認する。
4. DB sessionを強制終了する場合は運用承認を得る。
5. Lock解消後にplanからやり直す。

Unlockに失敗したconnectionはpoolへ戻さず破棄される。

### Checksum drift

対応:

1. Applyを停止する。
2. `schema_migrations`を手動更新しない。
3. 適用済みmanifestの変更commitを特定する。
4. 変更をrevertするか、新version migrationへ分離する。
5. Schemaとdeployment historyを照合する。

### Provider mismatch / history gap

- 同じDB historyへSQLite / PostgreSQLを混在させない。
- Database URL、schema、target environmentを確認する。
- Missing historyを推測で追加しない。

### Migration SQL failure

Runnerは対象migrationのDDLとhistory INSERTをrollbackする。

対応:

1. Errorのmigration version / nameを内部traceから確認する。
2. Raw errorに機微情報が含まれる可能性があるため公開Issueへ貼らない。
3. Schemaにpartial objectが残っていないことを確認する。
4. 初回失敗では`schema_migrations`も残っていないことを確認する。
5. Migration SQLを修正する。
6. 実PostgreSQL integration testを追加・更新する。
7. Review後にplanから再実行する。

Rollbackに失敗したconnectionはpoolへ戻さず破棄される。

### Statement / lock timeout

- Timeoutを成功扱いしない。
- 長時間transactionやblocking sessionを調査する。
- 安易に上限を無制限化しない。
- 上限変更は対象migrationのrehearsal結果と運用承認に基づく。

### TLS / certificate failure

- `rejectUnauthorized`を無効化して回避しない。
- Connection URLへ`sslmode=disable`を追加して回避しない。
- Hostname、CA bundle、RDS endpoint、network pathを確認する。
- Productionで`disable`へ切り替えない。

## Rollback境界

- Migration transaction内の失敗: runnerが自動rollbackする。
- Migration成功後・application write開始前: backup restoreを選択可能。
- PostgreSQL write開始後: 単純なSQLite rollbackは禁止。Write freezeとdata reconciliationが必要。
- Destructive down migrationは提供しない。

## 禁止事項

- Applied migrationの編集
- History checksumの手動上書き
- 複数Migratorの並行起動
- Application roleによるmigration
- TLS verification無効化によるProduction接続
- URL query parameterによるTLS設定上書き
- Statement / lock timeoutの無制限化
- Credential / SQL / data / raw causeの公開ログ出力
- DB cutoverとSQS transport切替の同時実施
