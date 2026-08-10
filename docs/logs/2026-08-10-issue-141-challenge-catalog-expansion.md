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
- 現行Worker isolation runnerはChallengeの`testCommand`を直接使わず、visible / hidden test pathを`node --test`へ渡す。

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

## Test harnessで見つかった問題

初回integrationでは4問すべてstarterが「test成功」と誤判定された。

原因はChallengeではなく、`challenge-content-contract.test.mjs`自身がNode test runner配下で動いており、子`node --test`へ内部環境変数`NODE_TEST_CONTEXT`が継承されたことだった。Nodeは再帰test実行と判断してtest fileをskipしexit 0にしていた。

対策として子processのenvから`NODE_TEST_CONTEXT`だけを除外し、実Runner相当の独立test processとして実行するよう修正した。修正後は新規4問すべてでstarter failure / reference solution successを確認した。

## 既存SQL Challengeで見つかった問題

`sql-monthly-sales`のProblem JSONは`python run_sql_tests.py` / `sqlite3`を前提としているが、現行Workerはそのcommandを実行せず`node --test`固定である。

そのため既存SQL Challengeはschema上は有効でも現行Workerでは安全に採点できないことを確認した。

PR #142ではscopeを広げて任意command実行を入れず、Webをfail-closedにした。

- language filterからSQLを除外。
- 一覧ではSQLを「採点準備中」と表示。
- 詳細では提出formを表示しない。
- `/submit`へSQL等の未対応languageを直接POSTしても400で拒否しAPIへforwardしない。

言語別Runner本体はIssue #143へ分離した。

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
- schema validation
- 既存integration回帰

## 境界

- Public Challengeはfile-backedを維持。
- Admin Challenge DB-backedとの統合はしない。
- SQL / Python / HTML-CSS Runnerは本PRへ追加しない。
- Problem JSON由来commandをそのままshell実行する仕組みを導入しない。
- Submission / lease / outboxは変更しない。
- Production runtimeはSQLite / HTTPを維持する。
