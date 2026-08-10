# Issue #141 実装ログ

日付: 2026-08-10
Issue: `#141 公開Challengeの検索・絞り込みとJS/TS実践問題を追加する`
PR: `#142 公開Challengeの検索・絞り込みとJS/TS実践問題を追加`
Branch: `feat/challenge-catalog-expansion`
Follow-up: `#143 SQL・Python・HTML/CSS向け言語別Runner contractを導入する`

## 目的

公開Challengeを増やし、学習者が目的に合う問題を探しやすくする。

## 事前確認

- 既存file-backed ChallengeはJavaScript / TypeScript / SQLが各1件、計3件。
- Problem schemaはPython / HTML-CSSも許可する。
- `/api/challenges` summaryにはfilterに必要なdifficulty / category / supportedLanguagesが既に含まれるため、API拡張は不要と判断した。
- 現行Node系runnerはChallengeの`testCommand`を直接使わず、visible / hidden test pathを`node --test`へ渡す。

## 実装

### Catalog

- `apps/web/src/challenge-catalog.mjs`を追加。
- keyword / difficulty / category / language filterを実装。
- GET query stringからfilterを復元。
- 未知enum値は無効化し、500にしない。
- 公開language filterは採点確認済みのJavaScript / TypeScriptに限定。
- Web一覧にfilter form・件数・0件表示を追加。
- query値をinputへ戻すためHTML attribute escapeを強化。
- 詳細画面の`metadata.type`誤参照を`metadata.category`へ修正。

### Content

4件追加し、file-backed Challenge数を3件から7件へ拡張。

1. `js-refactor-order-summary`
2. `js-bugfix-pagination-window`
3. `ts-feature-access-policy`
4. `ts-refactor-feature-flags`

各問題にvisible / hidden testを用意し、easy以外にmedium / hard、bugfix以外にfeature / refactorを拡充した。

### Runner language policy

採点可能言語を`packages/runner-sdk/src/language-policy.mjs`へ共通化した。

- JavaScript: runnable
- TypeScript: runnable
- SQL / Python / HTML-CSS: unsupported

Web / API / Workerが同じpolicyを参照する。TypeScriptはNode 22.23.1でAPI → queue → Worker → visible / hidden testまでE2E成功を確認した。

### Submission作成前guard

Public APIを直接呼び出してWebを迂回できるため、`createSubmissionAndEnqueue()`で永続化前にChallengeと言語を検証するよう変更した。

- `challengeSlug`を`^[a-z0-9-]+$`へ制限。
- Challenge存在確認。
- request slugとProblem metadata.slugの一致確認。
- ChallengeのsupportedLanguagesとrequest languageの一致確認。
- 共通runner allowlist確認。

SQL Challengeを`language=javascript`として偽装しても、submission / outbox作成前に400で拒否する。

## Test harnessで見つかった問題

初回integrationでは4問すべてstarterが「test成功」と誤判定された。

原因はChallengeではなく、`challenge-content-contract.test.mjs`自身がNode test runner配下で動いており、子`node --test`へ内部環境変数`NODE_TEST_CONTEXT`が継承されたことだった。Nodeは再帰test実行と判断してtest fileをskipしexit 0にしていた。

対策として子processのenvから`NODE_TEST_CONTEXT`だけを除外し、実Runner相当の独立test processとして実行するよう修正した。修正後は新規4問すべてでstarter failure / reference solution successを確認した。

## 既存SQL Challengeで見つかった問題

`sql-monthly-sales`のProblem JSONは`python run_sql_tests.py` / `sqlite3`を前提としているが、現行Workerはそのcommandを実行せずNode test runner固定である。

そのため既存SQL Challengeはschema上は有効でも現行Workerでは安全に採点できないことを確認した。

PR #142ではscopeを広げて任意command実行を入れず、Web / API / Workerをfail-closedにした。

- language filterからSQLを除外。
- 一覧ではSQLを「採点準備中」と表示。
- 詳細では提出formを表示しない。
- Web `/submit`へSQL等の未対応languageを直接POSTしても400で拒否しAPIへforwardしない。
- APIへ直接SQL submissionやlanguage偽装を送っても永続化前に拒否する。
- Workerもlegacy / internal queue経路で同じrunner policyを確認する。

言語別Runner本体はIssue #143へ分離した。

## 既存integration fixtureの修正

旧`api-flow.test.mjs`はWorkerのinfra failureを再現するため、Public APIへ`missing-challenge`をPOSTして201を期待していた。

Challenge存在検証を弱めてテストへ合わせるのではなく、infra failure fixtureを内部Repositoryで直接作成し、Worker `/jobs`へ正規queue messageとして投入する形へ変更した。これにより次を両立する。

- Public APIは存在しないChallengeを404で拒否する。
- Worker retry / infra_failed契約は従来どおりintegrationで検証する。

## テスト観点

- filterなし
- keyword title / slug
- difficulty / category / language
- 複合filter
- 0件
- 未知filter値
- SQL / Python filterを公開対応として扱わない
- Challenge採点可否のfail-closed判定
- HTML attribute escape
- 新規4問のstarterが未解決
- reference solutionでvisible / hidden通過
- TypeScript API → Worker E2E
- 存在しないChallenge拒否
- language偽装拒否
- unsafe slug拒否
- SQL direct API拒否
- Worker infra failure / retry回帰
- schema validation
- 既存integration回帰

## 境界

- Public Challengeはfile-backedを維持。
- Admin Challenge DB-backedとの統合はしない。
- SQL / Python / HTML-CSS Runnerは本PRへ追加しない。
- Problem JSON由来commandをそのままshell実行する仕組みを導入しない。
- Submission / outboxのatomic transactionは変更しない。
- Processing lease / attempt fencing / completion guardは変更しない。
- Production runtimeはSQLite / HTTPを維持する。
