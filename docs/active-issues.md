# active-issues（正本）

最終更新: 2026-08-12（Issue #143 / PR #144 言語別Runner contract）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #143 SQL・Python・HTML/CSS向け言語別Runner contractを導入する

- 優先度: P2
- 状態: Open / PR #144 Ready for review / mergeable
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/143`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/144`
- Branch: `feat/language-runner-contracts`
- Linear: 無料Issue上限のためGitHub Issue / Repository docsを管理正本とする。
- Ready移行時点のinline review thread: 0件。

#### 目的

Problem schemaで定義可能な言語とWorkerの実行能力を一致させ、Problem JSON由来の任意shell commandを導入せずにSQL / HTML-CSSを安全に提出可能化する。Pythonは隔離Runner contractまで先行整備し、本番隔離基盤が整うまではfail-closedを維持する。

#### 実装済み

- `packages/runner-sdk/src/runner-contract.mjs`を追加。
- JavaScript / TypeScript → `node-test`。
- SQL → `sqlite-readonly`。
- HTML/CSS → `html-css-static`。
- Python → `python-container` / isolated-preview。
- Web / API / Workerの公開allowlistをrunner contractから共通取得。
- Workerから`submission.language`をRunnerへ明示的に渡す。
- SQL参照専用validatorとin-memory SQLite evaluatorを追加。
- HTML/CSS静的evaluatorを追加。
- Python固定Docker runner contractを追加。
- Public Challengeを7件から9件へ拡充。
- `sql-monthly-sales`を実採点可能化。
- `html-css-feature-profile-card`を追加。
- `python-bugfix-score-buckets`を追加。ただしPublic submissionは拒否。
- SQL / HTML-CSSのAPI → queue → Worker E2Eを追加。
- Python Public API 400 fail-closed E2Eを追加。
- Python実Docker container contractをCIで検証。

#### Python隔離contract

固定image:

`python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd`

- network none。
- read-only root / workspace。
- tmpfs限定write。
- capability drop ALL。
- no-new-privileges。
- non-root UID/GID。
- CPU / memory / pids / nofile制限。
- host timeout + TERM/KILL。
- stdout/stderr 256KiB上限。
- shellを経由しない固定argv。

PythonはCI previewのみ。Public APIでは400で拒否する。

#### 実装中に検出・修正した事項

1. 存在しないPython image tagをCIで検出し、実pull確認済みdigestへ固定。
2. PR #142由来のSQL拒否unit testを新契約へ更新。
3. Node Runner timeoutに対し既存integration polling窓が不足していたため、fixtureを維持したまま上限のみ拡張。
4. 一時的に既存api-flow fixtureを広く変更してしまった差分は撤回し、mainの障害注入方式を維持。
5. Python Runnerの出力上限・非root・capability / privilege hardeningを追加。
6. WorkerのRunner dispatchがChallenge先頭languageを暗黙推測していたため、Submission languageを明示伝播し回帰テストを追加。

#### 最終確認

最終docs headで以下を成功確認済み。

- Docs validation: Success。
- Frozen lockfile install: Success。
- Lint: Success。
- Typecheck: Success。
- Unit test: Success。
- Integration test: Success。
- SQL / HTML-CSS content contract: Success。
- SQL / HTML-CSS API → queue → Worker E2E: Success。
- Python Public API fail-closed: Success。
- Python image pull / actual container contract: Success。
- PostgreSQL 18.4 integration: Success。
- Schema validation: Success。
- Infra validation: Success。
- Build: Success。
- PR #144: Ready for review / mergeable。
- Ready移行時点のinline review thread: 0件。

#### 完了条件

- Problem JSON由来commandをshell実行しない。
- SQLを参照専用固定Runnerで採点できる。
- HTML/CSSを実行せず静的評価できる。
- SQL / HTML-CSSをWeb / API / Workerで一貫して提出可能扱いする。
- Pythonは隔離contractを自動検証しつつPublic submissionを拒否する。
- starter failure / reference solution successを確認する。
- hidden test source / internal logsをlearnerへ返さない。
- Submission + outbox atomicity / lease / fencing / completion guardを変更しない。
- Production runtimeをSQLite / HTTPのまま維持する。
- 全品質ゲートが成功する。

### #145 Python Runnerの本番隔離実行基盤を導入する

- 優先度: P1
- 状態: Open / #143後続
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`

#### 目的

Issue #143で追加したPython container Runner contractを、Docker socketをWorkerへ公開せず本番で安全に実行できる専用隔離基盤へ接続する。

#### 必須条件

- 専用remote runner / ECS Task等の隔離境界。
- WorkerへDocker socketを公開しない。
- submitted codeからhidden test file自体を読めないfilesystem分離。
- pinned image digest。
- network / privilege / CPU / memory / pids / fd / timeout制限。
- orphan cleanup / retry / idempotency。
- concurrency / quota / cost上限。
- stagingで悪意あるcodeを含む隔離テスト。
- 上記完了後にのみPythonを公開allowlistへ追加する。

## Blocked Issue

### Python Challengeの公開提出可能化

- 状態: Blocked / Issue #145 required。
- Python contentはcatalogへ存在しても「採点準備中」とする。
- Web / API / Workerの公開allowlistへPythonを追加しない。

### ECS task definition / service wiring

- 状態: Blocked / DB移行依存あり。
- Admin Challenge async Repositoryまでは完了済み。
- Submission / lease / outbox Repository async移行、outbox claim / lease、RDS / secret / network IaC、data migration rehearsalが残る。

## Recently Completed

### #141 / PR #142（完了済み）

- 完了日: 2026-08-12（日本時間）。
- 公開Challenge検索・絞り込み、JS/TS実践問題4件、TypeScript実採点、Submission target validation、Web APIエラー表示をmainへ反映。

### #139 / PR #140（完了済み）

- Admin Challenge Repositoryをasync DatabaseClientへ移行。

### #137 / PR #138（完了済み）

- PostgreSQL 18.4 / `pg` / migration executor / 実DB contractを導入。

### #135 / PR #136（完了済み）

- Versioned migration / provider別schema / drift検出を導入。

## Follow-up候補

ユーザー価値:

1. Issue #145 Python本番隔離Runner。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページの実データ化。

基盤依存:

1. Submission read / simple write async移行。
2. Processing lease / attempt fencing async移行。
3. Submission + outbox atomic transaction async移行。
4. API / Worker DB provider切替。
5. Outbox claim / lease。
6. RDS / Secrets Manager / network IaC。
7. Data migration / staging cutover rehearsal。

## Scale / safety gate

- Runner未実装・未隔離言語を公開対応済みとして表示しない。
- Web / API / Workerでrunner allowlistを分散定義しない。
- 採点未対応languageをsubmission / outboxへ永続化しない。
- Problem JSON由来commandを任意shellとして実行しない。
- Hidden testsをlearner向け公開境界へ返さない。
- API processでsubmission codeを直接実行しない。
- Submission + outbox atomicityを弱めない。
- Processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
