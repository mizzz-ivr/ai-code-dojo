# Issue #135 Versioned migration runner 実装ログ

## 目的

SQLite / PostgreSQL共通のlogical schemaをversioned manifestとして管理し、SQLite runtimeへ安全なmigration履歴とdrift検出を導入する。

## 実装

- Migration contract
  - 1始まりの連番version
  - lowercase name
  - SQLite / PostgreSQL provider定義
  - canonical SHA-256 checksum
- Applied history
  - `schema_migrations`
  - version / name / provider / checksum / applied_at
- Validation
  - version gap
  - duplicate name
  - provider missing / mismatch
  - name drift
  - checksum drift
  - destructive SQL
  - PostgreSQLへのSQLite固有構文混入
- SQLite runner
  - migration単位`BEGIN IMMEDIATE`
  - schema変更とhistory insertのatomicity
  - rollback時に元例外を保持
  - existing schema introspection
  - rerun no-op
- CLI
  - apply
  - plan
  - status
- Versioned schema
  1. core schema
  2. submission attempt / lease
  3. queue outbox

## 既存挙動の維持

- Existing Repositoryは`DatabaseSync`を継続する。
- Legacy challenge / submission JSON importを維持する。
- Runtime databaseはSQLite `.data/app.db`。
- Queue transportはHTTP既定。
- API直接code execution禁止、hidden tests非公開を維持する。

## Test

- Manifest checksum / provider static validation
- Version gap / duplicate name / provider missing
- Applied checksum drift / provider mismatch / history gap
- Fresh DB migration
- Existing legacy submissions table migration
- Rerun no-op
- Failure時のschema / history rollback
- Existing unit / integration regression

## Initial CI

- Lint: Success
- Typecheck: Success
- Unit test: Success
- Integration test: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success

## 非対象

- `pg` package
- Actual PostgreSQL executor
- RDS / ECS
- Repository async migration
- Data cutover
- Destructive down migration

## 管理

- GitHub Issue: #135
- GitHub PR: #136
- Branch: `feat/versioned-migration-runner`
- Linear: Free Issue limitのため作成不可
