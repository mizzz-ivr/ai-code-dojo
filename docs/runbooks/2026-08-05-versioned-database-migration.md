# Versioned Database Migration Runbook

最終更新: 2026-08-05

## 目的

SQLite migrationのplan確認、適用、検証、異常時対応を安全に実施する。

## 前提

- 現行providerはSQLite。
- Production相当のPostgreSQL適用手順ではない。
- DB backupが必要な環境では、適用前に`.data/app.db`を停止状態で取得する。
- Submitted codeやhidden testsを含むDB backupを公開artifactへ保存しない。
- Runtime / migration CLIのSQLite接続には5秒の有限`busy_timeout`を設定する。

## 事前確認

```bash
pnpm install --frozen-lockfile
pnpm db:migrate --plan
```

確認項目:

- `provider`が`sqlite`である。
- Applied versionが1から連続している。
- Pending migrationが想定したversion / nameだけである。
- Checksum drift errorが出ていない。

## Status確認

```bash
pnpm db:migrate --status
```

Status / planはschemaを変更しない。DB fileが存在しない場合も新規fileを作成しない。

## 適用

```bash
pnpm db:migrate
```

正常時は以下を確認する。

- Commandがexit code 0で終了する。
- Pendingが空になる。
- SQL本文やdataがstdoutへ出ていない。

## 適用後確認

```bash
pnpm db:migrate --status
pnpm test:unit
pnpm test:integration
```

SQLite CLI等で直接確認する場合は、機微dataを表示しないqueryに限定する。

```sql
SELECT version, name, provider, applied_at
FROM schema_migrations
ORDER BY version;
```

期待値:

1. `core_schema`
2. `submission_attempt_and_lease`
3. `queue_outbox`

## Checksum drift発生時

例:

```text
Applied migration 2 checksum drift detected.
```

対応:

1. Migration適用を停止する。
2. `schema_migrations`を手動更新しない。
3. 適用済みmanifestが変更されたcommitを特定する。
4. 変更をrevertするか、新version migrationへ分離する。
5. Backupと対象環境のschemaを確認する。
6. Review後に再度`--plan`を実行する。

## Provider mismatch発生時

例:

```text
Applied migration 1 provider mismatch.
```

対応:

- 同じDBへSQLite / PostgreSQLの履歴を混在させない。
- Connection先とprovider設定を確認する。
- History rowの書き換えで回避しない。

## Version gap発生時

例:

```text
Applied migration history has a gap at version 2.
```

対応:

- Missing history rowが単なる履歴欠落か、schema未適用かを調査する。
- 自動適用を継続しない。
- Backup、schema、過去deployment logを照合する。

## SQLite lock競合発生時

Runtime / migration CLIは短時間のwrite lockに対して最大5秒待機する。

例:

```text
database is locked
```

5秒後も失敗する場合の対応:

1. API / Worker / migration commandの同時書き込み状況を確認する。
2. Migration実行中にapplication writeが継続していないか確認する。
3. Stale recovery scannerやoutbox dispatcherの実行間隔を確認する。
4. 同じmigration commandを並列実行していないか確認する。
5. Lock保持processを特定し、安全に停止できる場合だけ停止する。
6. Busy timeout値を安易に延長せず、長時間transactionの有無を調査する。

Busy timeout後のerrorを成功扱いしない。Migration適用時はapplication writeを停止する運用を優先する。

## Migration失敗時

Runnerはmigration単位でschema変更とhistory insertをrollbackする。

対応:

1. Commandを再実行し続けない。
2. Errorが発生したmigration version / nameを確認する。
3. DBがlock中でないことを確認する。
4. `--status`で最後に成功したversionを確認する。
5. Migration codeを修正する。
6. Unit testでpartial table / historyが残らないことを確認する。
7. Review後に再適用する。

Rollback failureが発生しても、runnerは元migration errorを優先する。DB connectionやfilesystem異常が疑われる場合はbackupからの復旧判断を行う。

## Existing untracked DBのbaseline

`schema_migrations`が存在しない既存SQLite DBでは、version 1〜3を順に評価する。

- Existing tableは`CREATE TABLE IF NOT EXISTS`で維持する。
- Existing columnは`PRAGMA table_info`で判定する。
- Missing columnだけを追加する。
- 全step成功後にhistoryを記録する。

適用前に必ずbackupを取得し、staging相当環境でrehearsalする。

## 禁止事項

- 適用済みmigration fileの編集
- Checksum historyの手動上書き
- `DROP TABLE` / `DROP COLUMN` / `TRUNCATE`の追加
- Submitted code / hidden testsを含むDBの公開upload
- DB migrationとSQS transport切替の同時実施
- Production DBへの未検証PostgreSQL manifest適用
- Busy timeoutを無限待機の代替として扱うこと

## Rollback境界

- Migration適用前: SQLite backupへ戻せる。
- Migration適用後・application write再開前: backup restoreを選択できる。
- Application write再開後: 新規dataを失う単純restoreを行わない。Write freezeとdata reconciliationが必要。
