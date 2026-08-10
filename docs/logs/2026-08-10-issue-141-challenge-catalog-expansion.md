# Issue #141 実装ログ

日付: 2026-08-10
Issue: `#141 公開Challengeの検索・絞り込みとJS/TS実践問題を追加する`
PR: `#142 公開Challengeの検索・絞り込みとJS/TS実践問題を追加`
Branch: `feat/challenge-catalog-expansion`

## 目的

公開Challengeを3件から増やし、学習者が目的に合う問題を探しやすくする。

## 事前確認

- 既存公開ChallengeはJavaScript / TypeScript / SQLが各1件、計3件。
- Problem schemaはPython / HTML-CSSも許可する。
- 現行Worker isolation runnerはNode test runner前提。
- Python / HTML-CSSを問題定義だけ追加すると採点不能になるため非対象とした。
- `/api/challenges` summaryにはfilterに必要なdifficulty / category / supportedLanguagesが既に含まれるため、API拡張は不要と判断した。

## 実装

### Catalog

- `apps/web/src/challenge-catalog.mjs`を追加。
- keyword / difficulty / category / language filterを実装。
- GET query stringからfilterを復元。
- 未知enum値は無効化し、500にしない。
- 公開言語候補はJavaScript / TypeScript / SQLに限定。
- Web一覧にfilter form・件数・0件表示を追加。
- query値をinputへ戻すためHTML attribute escapeを強化。
- 詳細画面の`metadata.type`誤参照を`metadata.category`へ修正。

### Content

4件追加し、公開Challenge数を3件から7件へ拡張。

1. `js-refactor-order-summary`
2. `js-bugfix-pagination-window`
3. `ts-feature-access-policy`
4. `ts-refactor-feature-flags`

各問題にvisible / hidden testを用意し、easy以外にmedium / hard、bugfix以外にfeature / refactorを拡充した。

## Test harnessで見つかった問題

初回integrationでは4問すべてstarterが「test成功」と誤判定された。

原因はChallengeではなく、`challenge-content-contract.test.mjs`自身がNode test runner配下で動いており、子`node --test`へ内部環境変数`NODE_TEST_CONTEXT`が継承されたことだった。Nodeは再帰test実行と判断してtest fileをskipしexit 0にしていた。

対策として子processのenvから`NODE_TEST_CONTEXT`だけを除外し、実Runner相当の独立test processとして実行するよう修正した。

## テスト観点

- filterなし
- keyword title / slug
- difficulty / category / language
- 複合filter
- 0件
- 未知filter値
- Python filterを公開対応として扱わない
- HTML attribute escape
- 新規4問のstarterが未解決
- reference solutionでvisible / hidden通過
- schema validation
- 既存integration回帰

## 境界

- Public Challengeはfile-backedを維持。
- Admin Challenge DB-backedとの統合はしない。
- Python / HTML-CSS Runnerは追加しない。
- Submission / lease / outboxは変更しない。
- Production runtimeはSQLite / HTTPを維持する。
