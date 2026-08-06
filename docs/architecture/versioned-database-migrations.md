# Versioned Database Migrations

最終更新: 2026-08-05

## 目的

SQLiteからManaged PostgreSQLへ段階移行する間も、schema変更の順序・内容・適用状態を検証可能にし、partial migrationや意図しないdriftを防止する。

## 前提

- 現行runtimeはSQLite。
- PostgreSQL schemaは定義するが、実PostgreSQL executorは後続Issueで実装する。
- API / Worker startupで将来的にDDLを実行しない構成へ移行する。
- Production相当ではone-shot Migrator taskだけがschema migrationを担当する。

## Migration manifest

Migrationは以下を持つ。

- `version`
  - 1から始まる連番。
  - Gapと重複を許可しない。
- `name`
  - lowercase SQL identifier形式。
  - 一度適用したnameを変更しない。
- `providers.sqlite.steps`
- `providers.postgresql.steps`

Providerごとのstepsを含むcanonical objectからSHA-256 checksumを生成する。

## 適用済み履歴

`schema_migrations`へ以下を記録する。

| Column | Type | Purpose |
| --- | --- | --- |
| `version` | INTEGER | Migration順序と一意性 |
| `name` | TEXT | 人間が識別できる変更名 |
| `provider` | TEXT | SQLite / PostgreSQL混在防止 |
| `checksum` | TEXT | 適用後のmanifest改変検出 |
| `applied_at` | TEXT | ISO 8601 UTC適用日時 |

## Drift validation

適用前に履歴全件をversion昇順で読み、以下を検証する。

- Versionが1から連続している。
- Manifestに同じversionが存在する。
- Nameが一致する。
- Providerが一致する。
- Checksumが一致する。

不一致時は自動修復・履歴更新・migration再適用を行わず、fail-closedとする。

## SQLite execution

### Apply flow

1. Manifest全体を検証する。
2. Existing historyを読み、driftを検証する。
3. `schema_migrations`を作成する。
4. Pending migrationをversion昇順で処理する。
5. Migrationごとに`BEGIN IMMEDIATE`を開始する。
6. Provider stepsを実行する。
7. 同じtransactionでhistory rowをinsertする。
8. Commitする。
9. 失敗時はrollbackし、元例外を保持する。

### Existing schema baseline

Issue #135以前のSQLite DBには`schema_migrations`が存在しない。

- `CREATE TABLE IF NOT EXISTS`で既存tableを維持する。
- `PRAGMA table_info`でcolumn存在を確認する。
- 不足columnだけを`ALTER TABLE ... ADD COLUMN`する。
- Indexは`CREATE INDEX IF NOT EXISTS`で補完する。
- 全step成功後にhistoryを記録する。

これにより、fresh DBと既存DBへ同じmigration chainを適用する。

## Versioned logical schema

### Version 1: `core_schema`

- `challenges`
- `challenge_versions`
- `submissions`
- Challenge検索index

### Version 2: `submission_attempt_and_lease`

- `grading_attempt`
- `attempt_idempotency_key`
- `completion_guard_at`
- `processing_claimed_at`
- `processing_heartbeat_at`
- `processing_lease_expires_at`
- Attempt / idempotency key unique indexes

### Version 3: `queue_outbox`

- `queue_outbox`
- Pending / published status constraint
- Publish attempts非負制約
- Submission + grading attempt一意制約
- Pending scan index

## PostgreSQL compatibility

PostgreSQL stepsは以下を禁止する。

- `PRAGMA`
- `BEGIN IMMEDIATE`
- `INSERT OR ...`
- `AUTOINCREMENT`
- `?` placeholder

初回移行ではprovider差分を小さくするため、以下をTEXTのまま維持する。

- ID
- ISO 8601 UTC timestamp
- JSON payload

`uuid` / `jsonb` / `timestamptz`への変換は別migrationとして扱う。

## CLI

### Apply

```bash
pnpm db:migrate
```

### Plan

```bash
pnpm db:migrate --plan
```

### Status

```bash
pnpm db:migrate --status
```

出力はevent、provider、version、nameだけに限定する。

## セキュリティ境界

Migration logへ以下を出力しない。

- SQL本文
- Parameters
- Submitted code
- Hidden tests
- Database credentials
- Connection string
- Raw database error payload

## 運用ルール

- 適用済みmigrationを編集しない。
- 変更は必ず新versionで追加する。
- Checksum driftを履歴書き換えで解消しない。
- Destructive migrationはこのrunnerへ追加しない。
- DB cutoverとSQS transport切替を同じchange windowへ含めない。
- Production相当の適用前にstaging rehearsalとbackup validationを行う。

## 後続Issue

- PostgreSQL executorと実DB integration test
- Repository async migration
- Outbox claim / lease
- RDS / Secrets Manager / network IaC
- SQLite export / PostgreSQL import / invariant validation
- ECS one-shot Migrator task wiring
