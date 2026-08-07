# Issue #139 Admin Challenge Repository async化 実装ログ

## 目的

DB-backedなAdmin Challenge Repositoryを同期SQLite固有APIからasync DatabaseClientへ移行し、SQLite / PostgreSQL共通契約を確立する。

## 実装

- `createAdminChallengeRepository({ databaseClient })`を追加
- Repositoryから`getDb()` / `prepare()` / `run()`直接依存を除去
- 現行SQLite runtime用`getRuntimeDatabaseClient()`を追加
- Challenge作成 + Version 1をtransaction化
- Version追加 + current version pointer更新をtransaction化
- 既存export名とServer呼び出しを維持
- SQLite / PostgreSQL共通Repository contract testを追加
- 実PostgreSQL 18.4でRepository contractを実行

## 自己レビューで追加した改善

PostgreSQLで同一ChallengeへVersion追加が同時実行された場合、単純な`MAX(version) + 1`では同じversionを採番する可能性がある。

対策:

- Version採番前にChallenge rowをwrite lock相当で確保する。
- SQLiteは既存DatabaseClientの`BEGIN IMMEDIATE`を利用する。
- PostgreSQLは`UPDATE challenges SET updated_at = updated_at WHERE id = ?`でrow lockを取得する。
- Lock取得後に`MAX(version)`を読み、Version INSERTとcurrent pointer更新まで同一transactionで処理する。
- 実PostgreSQLで2件を同時追加し、Version 1 / 2 / 3が連番になるintegration testを追加する。

## Public Challenge境界

公開Challenge Repositoryは`problems/examples/*/problem.json`を読み込むfile-backed実装のまま維持する。

今回、公開コンテンツのdata source切替やhidden testsの公開境界は変更していない。

## 初回CI

最初のRepository / contract test追加時点で以下が成功した。

- Frozen lockfile install
- Lint
- Typecheck
- Unit test
- PostgreSQL integration test
- Schema validation
- Infra validation
- Build

同時Version追加対策とdocs反映後に最終headで再実行する。

## 管理

- GitHub Issue: #139
- GitHub PR: #140
- Branch: `feat/challenge-repository-async-db`
- Linear: 無料Issue上限のため作成不可

## 非対象

- Public Challenge Repository DB移行
- Submission Repository
- Processing lease / fencing
- Queue outbox transaction
- Production DB provider切替
- RDS / ECS / Secrets Manager
- Data migration / cutover
