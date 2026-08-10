# Admin Challenge Async Repository Architecture

最終更新: 2026-08-07

## 目的

DB-backedなAdmin Challenge Repositoryをprovider固有APIから分離し、SQLite / PostgreSQLで同じRepository契約を利用できるようにする。

公開Challengeのコンテンツ配信方式は変更しない。

## 対象境界

対象:

- `apps/api/src/repositories/admin-challenge-repository.mjs`
- `challenges`
- `challenge_versions`
- Admin Challengeの作成、Version追加、公開状態変更、取得

非対象:

- `apps/api/src/repositories/challenge-repository.mjs`
- `problems/examples/*/problem.json`からの公開Challenge配信
- Submission / lease / outbox Repository
- Application全体のDB provider切替

## Repository構成

`createAdminChallengeRepository({ databaseClient })`をprovider非依存の実装境界とする。

依存するDatabaseClient API:

- `query(sql, parameters)`
- `execute(sql, parameters)`
- `transaction(operation)`

Repository本体では以下を使用しない。

- `node:sqlite`
- `DatabaseSync`
- `prepare()`
- `run()`
- `BEGIN IMMEDIATE`
- PostgreSQL `Pool` / `Client`

## 現行runtime互換

`apps/api/src/db/runtime-database-client.mjs`が既存`getDb()`のSQLite singletonを`createSqliteDatabaseClient()`で包む。

現時点では意図的にSQLite固定とする。

理由:

1. Repository移行とProduction provider切替を同一PRへ混ぜない。
2. Existing API / Worker runtimeの変更範囲を限定する。
3. PostgreSQLへの切替はSubmission / outboxを含むcomposition root整備後に行う。

`closeDatabase: false`とし、既存SQLite connectionのlifecycle ownerを変更しない。

## Transaction境界

### Challenge作成

次の2書込みを同一transactionへ含める。

1. `challenges` row作成
2. `challenge_versions` Version 1作成

Version payloadのserializationやVersion INSERTが失敗した場合、Challenge rowだけを残さない。

### Version追加

次の処理を同一transactionへ含める。

1. 対象Challenge rowをwrite lock相当で確保
2. `MAX(version)`を取得
3. 次VersionをINSERT
4. `current_version_id`と`updated_at`を更新

同一Challengeへの同時Version追加で重複Version番号を生成しないことを必須とする。

Provider差異:

- SQLite: DatabaseClientの`BEGIN IMMEDIATE`でwrite transactionを直列化
- PostgreSQL: `UPDATE challenges SET updated_at = updated_at WHERE id = ?`でChallenge row lockを取得してから採番

`UNIQUE(challenge_id, version)`は最終防御として維持するが、通常フローの競合制御をconstraint errorだけへ依存させない。

## Read model

Admin RepositoryのVersion payloadには管理・採点用途として`hiddenTests`を保持する。

Learner向け公開境界は別Repositoryの`toPublicChallenge()`が担い、hidden testsを返さない。今回この境界は変更しない。

## Compatibility

既存exportを維持する。

- `listAdminChallenges`
- `getAdminChallengeById`
- `createAdminChallenge`
- `createAdminChallengeVersion`
- `setChallengePublishStatus`
- `findPublishedChallengeBySlug`

Server側のimport / route contractは変更しない。

## Test戦略

同一Repository contractをSQLiteと実PostgreSQLへ適用する。

共通確認:

- empty list
- Challenge create
- duplicate slug
- Version 1
- Version append
- current version pointer
- 過去Version保持
- publish / draft
- published slug lookup
- missing resource
- create failure rollback

PostgreSQL追加確認:

- 同一Challengeへの2件のVersion同時追加
- Versionが`1, 2, 3`の連番として残る
- current version pointerが最新Versionを指す

## Correctness・Security境界

- Challenge更新は既存Versionを上書きせず新Versionを追加する。
- Hidden testsをlearner向け公開Repositoryへ移さない。
- SQL parameterへpayloadを渡し、文字列連結でdataを埋め込まない。
- DB error、payload、hidden testsを新規ログへ出力しない。
- Production runtimeの既定DBはSQLiteのまま維持する。
- Public Challenge data sourceはfile-backedのまま維持する。

## 後続

1. Submission read / simple writeをasync DatabaseClientへ移行
2. Processing lease / attempt fencingを移行
3. Submission + queue outbox atomic transactionを移行
4. API / Worker composition rootでprovider選択を接続
5. Outbox claim / lease、RDS IaC、data migrationへ進む
