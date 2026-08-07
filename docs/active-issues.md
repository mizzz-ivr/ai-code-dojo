# active-issues（正本）

最終更新: 2026-08-07（Issue #139 / PR #140を実装中）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #139 Admin Challenge Repositoryをasync DatabaseClientへ移行する

- 優先度: P2
- 状態: Open / In Progress
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/139`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/140`
- Branch: `feat/challenge-repository-async-db`
- Linear: 無料Issue上限により作成不可。GitHub Issue / Repository docs / Notionを管理正本とする。

#### 目的

DB-backedなAdmin Challenge Repositoryを同期SQLite固有APIからasync DatabaseClientへ移し、SQLite / PostgreSQLで同じRepository契約を保証する。

#### 対象

- Admin Challenge Repository factory
- DatabaseClient注入
- 現行SQLite runtime adapter境界
- Challenge + Version 1 atomic create
- Version append + current pointer atomic update
- Challenge単位のVersion採番直列化
- SQLite / PostgreSQL共通Repository contract
- 実PostgreSQL 18.4 integration test
- Existing Repository export / Admin API contract維持
- Architecture / log / prompt / handoff / canonical docs

#### 非対象

- Public Challenge RepositoryのDB移行
- `/api/challenges` data source切替
- Submission Repository
- Processing lease / attempt fencing
- Submission + queue outbox atomic transaction
- Application全体のPostgreSQL切替
- RDS / ECS / Secrets Manager
- Data migration / production cutover

#### 完了条件

- Repository本体が`getDb()` / `prepare()` / `run()`へ直接依存しない。
- Challenge作成とVersion 1保存がatomicである。
- Version追加とcurrent pointer更新がatomicである。
- 同一Challengeへの同時Version追加で重複versionを作らない。
- SQLite / PostgreSQLで同じRepository contractが成功する。
- 既存Versionを上書きしない。
- Public file-backed Challenge配信へ副作用がない。
- Production runtimeをSQLite / HTTPのまま維持する。
- 全品質ゲートが成功する。

#### 現在の確認結果

初回Repository / contract test実装時点:

- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- PostgreSQL integration test: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success

自己レビューでPostgreSQL同時Version採番の競合余地を検出し、Challenge row lockとconcurrency integration testを追加した。最終docs反映後に全品質ゲートを再確認する。

## Blocked Issue

### ECS task definition / service wiring

- 状態: Blocked / Implementation dependencies required
- 再開条件:
  1. DB adapter contract: PR #134で完了
  2. Versioned schema / SQLite runner: PR #136で完了
  3. 実PostgreSQL test / executor: PR #138で完了
  4. Repository async移行: Issue #139から段階進行
  5. Outbox claim / lease
  6. RDS / secret / network IaC
  7. Data migration tool / staging rehearsal

## Recently Completed

### #137 / PR #138（完了済み）

- 完了日: 2026-08-07（日本時間）
- 反映内容: PostgreSQL 18.4、`pg` driver、実PostgreSQL migration executor、DatabaseClient実DB contract、migration安全対策を実装した。

### #135 / PR #136（完了済み）

- 完了日: 2026-08-06（日本時間）
- 反映内容: Versioned migration manifest、provider別schema、checksum / drift検出、SQLite runner、有限busy timeoutを実装した。

### #133 / PR #134（完了済み）

- 完了日: 2026-08-05（日本時間）
- 反映内容: Async DatabaseClient contract、SQLite adapter、PostgreSQL provider境界、共通contract testを実装した。

### #131 / PR #132（完了済み）

- 完了日: 2026-08-05（日本時間）
- 反映内容: RDS PostgreSQL採用、API / Worker / Migrator分離、DB role / secret / network、cutover / rollback、後続Issue依存順を設計した。

## Follow-up Issue Candidates

依存順:

1. Submission read / simple writeのasync移行（P2）
2. Submission processing lease / attempt fencingのasync移行（P2）
3. Submission + queue outbox atomic transactionのasync移行（P2）
4. API / Worker composition rootのprovider切替（P2）
5. Outbox claim / leaseと複数API instance安全化（P2）
6. RDS PostgreSQL / Secrets Manager / security group IaC（P2）
7. SQLite export / PostgreSQL import / validation tool（P2）
8. API / Worker / Migrator ECS wiring（P2）
9. Staging cutover rehearsal / rollback drill（P2）
10. Public ChallengeをDB-backed管理へ統合するかの設計（P2）
11. Challengeコンテンツ拡充（言語・難易度・カテゴリ追加）（P2）

## Scale gate

- Outbox claim / lease完了前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Repository実PostgreSQL contract test前にproduction DBへ切り替えない。
- Challenge Versionは既存rowを上書きせず新versionとして追加する。
- Hidden testsをlearner向け公開境界へ返さない。
- Submission + outbox atomicityをRepository移行で弱めない。
- Processing lease / attempt fencing / completion guardを弱めない。
- Application roleへDDL権限を付与しない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
