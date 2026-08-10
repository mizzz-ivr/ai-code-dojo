# current-status（正本）

最終更新: 2026-08-10（Issue #141 / PR #142 公開Challenge catalog拡充を実装）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repositoryのcanonical full nameは`mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP運用を継続中。
- HTTP / SQS queue runtime、transactional outbox、processing lease / heartbeat、attempt fencing、completion guard、stale recoveryを実装済み。
- PR #132でManaged PostgreSQL移行とAPI / Worker / Migrator分離設計をmerge済み。
- PR #134でprovider非依存のasync DatabaseClient contractをmerge済み。
- PR #136でversioned migration runnerとSQLite / PostgreSQL共通logical schemaをmerge済み。
- PR #138で実PostgreSQL migration executor、`pg` driver、実DB integration testをmerge済み。
- PR #140でDB-backedなAdmin Challenge Repositoryをasync DatabaseClientへ移行済み。
- Issue #141 / PR #142で公開Challenge catalogの検索・絞り込みとJS/TS実践問題4件を実装中。
- Linearは無料Issue上限のため、Issue #141はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Production相当のDatabase providerはSQLite `.data/app.db`。
- Queue transportの既定値はAPI / WorkerともHTTP。
- Public Challenge Repositoryは`problems/examples/*/problem.json`を読むfile-backed実装。
- Admin Challenge Repositoryは`challenges` / `challenge_versions`をDB-backedで管理し、async DatabaseClientを使用する。
- Submission / lease / outbox Repositoryは引き続き同期SQLite固有APIへ依存する。
- API / Workerの各SQLite接続へ5秒の有限`busy_timeout`を設定している。
- GitHub ActionsではPostgreSQL 18.4 service containerによる実DB integration testを実行する。
- RDS、ECS、Secrets Manager resourceは未作成。
- APIで提出コードを直接実行せず、hidden testsをlearnerへ返さない。

## 公開Challenge catalog（Issue #141 / PR #142）

### Challenge数

変更前: 3件。

- `js-bugfix-add`
- `ts-feature-user-display`
- `sql-monthly-sales`

追加4件:

- `js-refactor-order-summary`: medium / refactor / JavaScript
- `js-bugfix-pagination-window`: hard / bugfix / JavaScript
- `ts-feature-access-policy`: medium / feature / TypeScript
- `ts-refactor-feature-flags`: hard / refactor / TypeScript

変更後: 7件。

### 問題一覧

- title / slugのkeyword部分一致。
- difficulty: easy / medium / hard。
- category: bugfix / feature / sql / refactor。
- language: javascript / typescript / sql。
- 複合filter対応。
- GET query stringで条件を保持。
- 一致0件のempty state。
- `filtered / total`件数表示。
- mobile幅ではfilterを1列化。
- 未知enum値はfilter無効として扱い、500にしない。
- query値をinput属性へ戻すため`"` / `'`を含むHTML attribute escapeを行う。
- 問題詳細の誤った`metadata.type`参照を正式な`metadata.category`へ修正。

### 言語公開境界

Problem schemaは`python` / `html-css`も予約しているが、現行Worker isolation runnerはNode test runner前提。

そのため公開catalogへ表示する対応言語は、現時点で採点可能性を確認できるJavaScript / TypeScript / SQLに限定する。Python / HTML-CSSはRunner実装と実行契約テスト完了後に別Issueで公開する。

### Content contract test

新規4問について以下をintegration testで保証する。

- editable starterが存在する。
- `networkAccess: disabled`。
- starter状態ではvisible / hidden全testを通過しない。
- reference solutionではvisible / hidden全testが成功する。

初回integrationでは、親のNode test runnerから内部環境変数`NODE_TEST_CONTEXT`が子`node --test`へ継承され、再帰testとして全fileがskipされexit 0になる検証ハーネス不具合を検出した。

子processから`NODE_TEST_CONTEXT`だけを除外して実Runner相当の独立processにし、回帰テストを有効化した。修正後はintegration / buildまで成功済み。

## Admin Challenge async Repository（PR #140でmerge済み）

- `createAdminChallengeRepository({ databaseClient })` factoryを追加済み。
- Admin Challenge Repositoryから`getDb()` / `prepare()` / `run()`の直接依存を除去済み。
- Challenge作成 + Version 1保存を同一transactionで処理する。
- Version追加 + `current_version_id`更新を同一transactionで処理する。
- Challenge Versionは既存Versionを書き換えず追加する。
- SQLite / PostgreSQL共通Repository contract testを実行する。
- PostgreSQLではChallenge row lock後に`MAX(version) + 1`を採番し、同時Version追加を直列化する。

## PostgreSQL実行基盤（PR #138でmerge済み）

- PostgreSQL 18.4 / `pg` 8.22.0を固定。
- 接続設定をfail-closedで検証する。
- Production既定TLSは`verify-full`。
- URL query parameter / fragmentによる接続設定上書きを拒否する。
- Statement / lock timeoutを有限化する。
- Migration executorは専用connection、search path固定、非待機advisory lockを使用する。
- Migration単位transactionでDDLとhistory INSERTをatomic commitする。
- Production runtimeのDB providerはこの基盤導入だけでは切り替えない。

## Correctness・セキュリティ境界

- Challenge更新はVersion追加方式を維持する。
- Submissionとqueue outboxのatomic commitを維持する。
- Processing lease / attempt fencing / completion guardを弱めない。
- Exactly-once queue deliveryへ依存しない。
- Queue / DB内部状態やhidden testsをlearnerへ返さない。
- API processでsubmission codeを直接実行しない。
- Public catalogへ採点不能言語を対応済みとして表示しない。
- Query parameterをHTMLへ埋め込む前にescapeする。
- Migration checksum driftを自動修復しない。
- SQL、parameters、credentials、submitted code、hidden testsを新規ログへ出力しない。
- DB cutoverとSQS transport切替を同じchange windowへ含めない。

## 現時点の非対応

- Python Challenge Runner / Python Challenge公開
- HTML/CSS評価Runner / Frontend Challenge公開
- Public Challenge RepositoryのDB-backed化
- Submission read / simple writeのasync DatabaseClient移行
- Processing lease / attempt fencingのasync移行
- Submission + queue outbox atomic transactionのasync移行
- API / Worker composition rootのDB provider切替
- Outbox claim / lease
- RDS / Secrets Manager / security group IaC
- SQLite export / PostgreSQL import / validation tool
- API / Worker / Migrator ECS wiring
- Staging cutover rehearsal / rollback drill
- Production DB / SQS切替

## 優先順位

ユーザー価値の次候補:

1. Python Runner + Python実践Challenge。
2. Challenge tag / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページを実submissionデータへ接続。
5. HTML/CSS評価Runner + Frontend Challenge。

基盤依存順:

1. Submission read / simple writeをasync DatabaseClientへ移行する。
2. Processing lease / attempt fencingをasync DatabaseClientへ移行する。
3. Submission + queue outbox atomic transactionを移行する。
4. API / Worker composition rootのprovider切替を実装する。
5. Outbox claim / leaseを実装する。
6. RDS / Secrets Manager / network IaCを追加する。
7. Data migration toolとstaging cutover rehearsalを実施する。
8. ECS one-shot MigratorとAPI / Worker wiringを追加する。

## 参照先

- Issue #141: `https://github.com/mizzz-ivr/ai-code-dojo/issues/141`
- PR #142: `https://github.com/mizzz-ivr/ai-code-dojo/pull/142`
- Public Challenge catalog: `docs/architecture/public-challenge-catalog.md`
- Issue #139: `https://github.com/mizzz-ivr/ai-code-dojo/issues/139`
- PR #140: `https://github.com/mizzz-ivr/ai-code-dojo/pull/140`
- Admin Challenge async repository: `docs/architecture/admin-challenge-async-repository.md`
- DB adapter contract: `docs/architecture/database-client-adapter-contract.md`
- PostgreSQL executor: `docs/architecture/postgresql-migration-executor.md`
