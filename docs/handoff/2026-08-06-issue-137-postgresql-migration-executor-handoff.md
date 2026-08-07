# Issue #137 Handoff

## 状態

- Issue: #137
- PR: #138
- Branch: `feat/postgresql-migration-executor`
- PR state: Ready for review / mergeable
- Production runtime: SQLite / HTTPを維持
- Linear: 無料Issue上限のため未作成
- Automated Codex review: 利用上限により未実行
- Manual self-review: 完了

## 完了した実装

- `pg` 8.22.0固定
- PostgreSQL 18.4 CI service container
- PostgreSQL config / Pool factory
- URL query parameter / fragment拒否
- Production TLS `verify-full`既定
- Statement / lock timeout
- PostgreSQL migration plan / status / apply
- 専用connection / search path固定
- Non-blocking advisory migration lock
- Migration単位transaction
- Initial history table bootstrap atomicity
- DDL / history atomicity
- Rollback / unlock失敗connection破棄
- Safe CLI failure JSON
- PostgreSQL DatabaseClient実DB contract test
- PostgreSQL migration integration test
- CLI provider切替
- Architecture / runbook / canonical docs

## 重要な判断

- Production TLSは`verify-full`を既定とする。
- SSL disableはlocalhost / testだけ許可する。
- Connection URLへquery parameter / fragmentを許可しない。
- 同時Migratorは待機せず失敗させる。
- Statement / lock待機は有限化する。
- Migrator roleだけがDDL権限を持つ。
- API / Worker application roleへDDL権限を与えない。
- Migration table作成はadvisory lock取得後、Migration 1 transaction内で行う。
- Applied migrationは不変とし、変更は新versionで追加する。
- Plan / statusはread-onlyとする。
- CLI failureはallowlist JSONだけを出力する。
- Rollback / unlock失敗connectionはpoolへ戻さない。
- Runtime RepositoryのPostgreSQL切替は別Issueとする。

## Test状態

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit: Success
- Schema validation: Success
- Infra validation: Success
- PostgreSQL 18.4 integration: Success
- Build: Success

追加した安全回帰test:

- URL query / fragment拒否
- Statement / lock timeout境界
- CLI password / host / raw cause非出力
- Initial Migration 1 bootstrap rollback
- Advisory unlock失敗時のconnection破棄

## CIで検出した問題

Migration table SQLを共通moduleへ移した後、既存unit testが旧SQLite runnerから定数をimportして失敗した。

対応:

- Import先を`migration-table-sql.mjs`へ変更。
- Test内容は変更しない。
- 修正後unit test成功。

## Manual self-reviewで検出した問題

1. URL queryによるTLS設定上書き余地
2. CLI uncaught error / causeの機微情報展開余地
3. Advisory unlock失敗connectionのpool再利用
4. Initial migration failure後のbootstrap table残存
5. Statement / lock待機上限不足

すべて修正し、個別のunit / integration regression testを追加した。

## 次の推奨Issue

Challenge Repositoryをasync DatabaseClientへ移行する。

推奨分割:

1. Challenge Repository移行
2. Submission read / simple write移行
3. Submission processing lease / attempt fencing移行
4. Submission + outbox atomic transaction移行
5. Worker / API composition rootのprovider切替

一度に全Repositoryを変更せず、各PRでSQLite / PostgreSQL両provider contractを維持する。

## 次Issueのgate

- Existing API response / error contractを変更しない。
- Challenge payload内のhidden testsをlearner APIへ返さない。
- SQL / parameters / payloadをDB logへ出力しない。
- SQLiteを既定providerとして維持する。
- SQLite / PostgreSQLへ同じRepository contract testを適用する。
- Provider固有placeholderやrow shapeをRepositoryへ漏らさない。
- Submission + outbox transactionを同一connectionで実行する後続設計を妨げない。
- Conditional UPDATEの`rowCount`をownership判定に使用する。
- PostgreSQLではstale recoveryで必要に応じて`SELECT ... FOR UPDATE`を使用する。
