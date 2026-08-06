# Issue #137 Handoff

## 状態

- Issue: #137
- PR: #138
- Branch: `feat/postgresql-migration-executor`
- Production runtime: SQLite / HTTPを維持
- Linear: 無料Issue上限のため未作成

## 完了した実装

- `pg` 8.22.0固定
- PostgreSQL 18.4 CI service container
- PostgreSQL config / Pool factory
- PostgreSQL migration plan / status / apply
- 専用connection / search path固定
- Non-blocking advisory migration lock
- Migration単位transaction
- DDL / history atomicity
- PostgreSQL DatabaseClient実DB contract test
- PostgreSQL migration integration test
- CLI provider切替
- Architecture / runbook / canonical docs

## 重要な判断

- Production TLSは`verify-full`を既定とする。
- SSL disableはlocalhost / testだけ許可する。
- 同時Migratorは待機せず失敗させる。
- Migrator roleだけがDDL権限を持つ。
- API / Worker application roleへDDL権限を与えない。
- Migration table作成はadvisory lock取得後に行う。
- Applied migrationは不変とし、変更は新versionで追加する。
- Plan / statusはread-onlyとする。
- Runtime RepositoryのPostgreSQL切替は別Issueとする。

## Test状態

- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit: Success
- Schema validation: Success
- Infra validation: Success
- PostgreSQL 18.4 integration: Success
- Docs validation: Success
- 最終docs headでbuildを含む全品質ゲートを再確認する。

## CIで検出した問題

Migration table SQLを共通moduleへ移した後、既存unit testが旧SQLite runnerから定数をimportして失敗した。

対応:

- Import先を`migration-table-sql.mjs`へ変更。
- Test内容は変更しない。
- 修正後unit test成功。

## 次の推奨Issue

Submission / challenge / queue outbox Repositoryをasync DatabaseClientへ段階移行する。

推奨分割:

1. Challenge Repository移行
2. Submission read / simple write移行
3. Submission processing lease / attempt fencing移行
4. Submission + outbox atomic transaction移行
5. Worker / API composition rootのprovider切替

一度に全Repositoryを変更せず、各PRでSQLite / PostgreSQL両provider contractを維持する。

## 次Issueのgate

- Submission + outbox transactionを同一connectionで実行する。
- Conditional UPDATEの`rowCount`をownership判定に使用する。
- PostgreSQLではstale recoveryで必要に応じて`SELECT ... FOR UPDATE`を使用する。
- Existing API responseとlearner-safe errorを変更しない。
- Hidden tests / submitted codeをDB logへ出力しない。
- Production provider defaultはSQLiteのまま維持する。
