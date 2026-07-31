# SQLite -> PostgreSQL cutover runbook（Draft）

最終更新: 2026-08-01

- 状態: Draft / 実行禁止
- 関連Issue: #131
- 対象: Staging rehearsalおよび将来のproduction相当cutover

## 重要

このrunbookは設計段階の手順案である。Export / import / validation tool、RDS IaC、ECS task definitionが未実装のため、現時点で実行してはならない。

Actual command、resource name、担当者、停止時間は後続Issueで確定する。

## 目的

SQLite `.data/app.db`からRDS for PostgreSQLへ、data整合性とrollback境界を明示して切り替える。

## 前提

- PostgreSQL schema migrationが完了している。
- API / WorkerがSQLite / PostgreSQL双方のrepository contract testに合格している。
- Export / import / validation toolが対象commitでbuild済みである。
- RDS backup / PITR / manual snapshotが有効である。
- DBはprivate subnet、TLS verify-full、service別DB userで接続する。
- API desired countは1、outbox dispatcherも1 instanceである。
- Production transportはHTTPのままとする。
- SQS切替を同じchange windowへ含めない。

## 役割

- Change owner: 全体進行、承認、停止 / 再開判断
- DB operator: Schema / import / validation / snapshot
- Application operator: API / Worker停止、task definition切替、smoke test
- Reviewer: 件数 / invariant / security確認
- Incident commander: Rollback判断

1人が複数roleを兼務する場合も、判断項目を省略しない。

## Go / No-Go条件

### Go

- 最新quality gateが成功している。
- Staging rehearsalが同じtool versionで成功している。
- Export artifactの暗号化保存先と削除期限が決まっている。
- Restore drillが成功している。
- Maintenance告知と許容停止時間が承認されている。
- Rollback先SQLite backupの保存先とhashが確認できる。

### No-Go

- Schema migration checksum mismatch
- TLS verify-full失敗
- DB role privilege validation失敗
- Backup / restore未検証
- Export / import fixture不一致
- Current application commit不明
- Pending incidentまたはDB / queue alarm発報中

## Phase 1: Preflight

記録する情報:

- Change ID
- Application commit
- Migration version
- Export tool version
- Source SQLite file path / size / SHA-256
- Target DB identifier / endpoint fingerprint
- RDS snapshot ID
- API / Worker task definition revision
- Start time

確認:

- API / Worker health
- Current submission status count
- Queue outbox status count
- Running submission count
- Pending outbox count
- Stale running count
- Disk free space
- RDS free storage / connections / CPU

Pending / running dataが存在する場合、cutover方針を明示する。

- 原則: New submission受付を停止し、runningがterminal化するまで待つ。
- Timeoutしたrunningは既存stale recovery contractに従って処理する。
- Pending outboxはHTTP transportでpublish完了させるか、validation対象として移行する。

## Phase 2: Maintenance開始

1. APIをmaintenance modeへ切り替え、新規submission / admin writeを拒否する。
2. Learner read endpointの継続可否を決定する。
3. Workerへ新規jobが入らないことを確認する。
4. Running submissionが0になるまで待つ。
5. API / Worker processを停止する。
6. SQLite fileをopenしているprocessがないことを確認する。

Maintenance開始後はSQLiteへのwriteを禁止する。

## Phase 3: SQLite backup

1. `.data/app.db`をimmutable backup locationへcopyする。
2. Backup fileのSHA-256とsizeを記録する。
3. Source fileとbackup fileのhash一致を確認する。
4. Access controlと削除期限を記録する。

禁止:

- Public GitHub Actions artifactへのupload
- Chat / IssueへのDB file添付
- Submitted code / hidden testsを含むexportの平文共有

## Phase 4: Export

Expected command placeholder:

```text
pnpm db:export-sqlite --source <path> --output <encrypted-dir>
```

Expected output:

- `export-manifest.json`
- `challenges.ndjson`
- `challenge-versions.ndjson`
- `submissions.ndjson`
- `queue-outbox.ndjson`

確認:

- Manifest source hashがSQLite backup hashと一致する。
- File checksumが一致する。
- Row countがdirect SQLite countと一致する。
- JSON line parse errorが0件である。

## Phase 5: Target DB準備

1. Target RDS manual snapshotを取得する。
2. Migrator one-shot taskを実行する。
3. Migration lock / checksum / versionを確認する。
4. Target application tablesがemptyであることを確認する。
5. API / Worker / Migrator role grantを検証する。
6. TLS verify-fullで接続できることを確認する。

Target tablesに予期しないdataがある場合はimportを開始しない。

## Phase 6: Import

Expected command placeholder:

```text
pnpm db:import-postgres --manifest <path> --target <secret-ref>
```

Rules:

- Migrator credentialだけを使用する。
- Raw passwordをCLI argument / process listへ出さない。
- Duplicate / FK / check violationで即時失敗する。
- Failure時はpartial importをrollbackするか、target DBを再作成する。
- Error logへsubmitted code / hidden testsを出さない。

## Phase 7: Validation

Expected command placeholder:

```text
pnpm db:validate-migration --manifest <path> --target <secret-ref> --report <path>
```

Required validation:

- Table row count
- Primary key集合
- Foreign key
- Unique constraint
- JSON parse
- Timestamp format
- Challenge current version
- Submission attempt / key
- Terminal completion guard
- Running lease fields
- Outbox submission / attempt整合
- Pending / published count

Validation reportへsecret、submitted code、hidden tests本文を含めない。

1件でもCritical invariantが失敗した場合、write再開へ進まない。

## Phase 8: Application cutover

1. API task definitionを`DATABASE_PROVIDER=postgres`へ切り替える。
2. API desired countを1で起動する。
3. API read-only smoke testを行う。
4. Worker task definitionをPostgreSQLへ切り替える。
5. Worker desired countを1で起動する。
6. Queue transportはHTTPのまま維持する。
7. DB connection / authentication / TLS / pool metricsを確認する。

## Phase 9: Smoke test

### Read

- Published challenge一覧
- Challenge詳細
- Existing submission結果
- Admin challenge一覧

### Write

Write再開承認前にtest tenant / fixtureで以下を確認する。

- Submission + outbox atomic作成
- HTTP Worker enqueue
- Worker claim / heartbeat / completion
- Learner-safe result
- Retry failure path
- Challenge version追加 / publish

### Security

- API task roleにWorker SQS権限がない。
- Worker task roleにAPI producer以外の管理権限がない。
- API / Worker DB userが別である。
- Application DB userにDDL権限がない。
- DB endpoint / passwordがlogへ出ていない。

## Phase 10: Write再開checkpoint

以下を全員で確認する。

- Validation report: Pass
- Smoke test: Pass
- Backup / snapshot: Available
- Metrics: Normal
- Rollback decision owner: Present
- SQLite backup hash: Recorded

Change ownerがwrite再開を承認する。

**Write再開後はSQLiteへの単純切戻しを禁止する。**

## Rollback A: Write再開前

適用条件:

- Import / validation / smoke failure
- PostgreSQLへlearner writeを受け付けていない

手順:

1. PostgreSQL接続のAPI / Workerを停止する。
2. Previous SQLite task / process configurationへ戻す。
3. Backup SQLite fileをrestoreする。
4. Hashを確認する。
5. API / WorkerをHTTP transportで起動する。
6. Existing flowをsmoke testする。
7. Maintenanceを解除する。

## Rollback B: Write再開後

単純なSQLite復帰はdata lossになるため禁止する。

優先順:

1. Application image / task definitionだけをrollbackし、PostgreSQLを継続利用する。
2. Corrective migrationを適用する。
3. RDS snapshot / PITRから別instanceをrestoreする。
4. Incident commander承認のreverse migrationを実施する。

Reverse migrationは別runbookとdata loss評価を必要とする。

## Post-cutover

- 24時間はAPI / Worker / DB / queue metricsを重点監視する。
- SQLite fileを即時削除しない。
- Backup retention期限までread-onlyで保管する。
- Export artifactは承認済み期限でsecure deleteする。
- Cutover reportへ件数、duration、incident、manual actionを記録する。
- Outbox claim / lease完了前にAPI desired countを増やさない。
- SQS transport切替は別changeとして実施する。

## 実装後に追記する項目

- Actual command
- AWS resource names
- Secret ARN / parameter名（値は記載しない）
- Expected row count query
- CloudWatch dashboard / alarm
- Maintenance response contract
- Restore drill evidence
- On-call contact
