# Issue #141 handoff

## 現在地

- Issue: #141
- PR: #142
- Branch: `feat/challenge-catalog-expansion`
- Follow-up: #143
- 目的: 公開Challenge catalogの検索性改善とJS/TS実践問題の拡充

## 実装済み

- file-backed Challenge 3件 → 7件
- keyword / difficulty / category / language filter
- query stringによるfilter保持
- 0件表示 / 件数表示
- 公開language filterをJavaScript / TypeScriptに限定
- 詳細画面の`metadata.category`表示修正
- HTML attribute escape強化
- filter / runnability unit test
- 新規Challenge content contract integration test
- 子`node --test`から`NODE_TEST_CONTEXT`を除外し、再帰test skipを防止
- SQL等の採点未対応ChallengeをWebでfail-closed
  - 一覧: 採点準備中
  - 詳細: submit form非表示
  - POST `/submit`: 400で拒否

## 新規Challenge

- `js-refactor-order-summary`
- `js-bugfix-pagination-window`
- `ts-feature-access-policy`
- `ts-refactor-feature-flags`

## 発見した既存課題

`sql-monthly-sales`はProblem JSONでPython / SQLite commandを定義しているが、現行Workerは`node --test`固定のためSQLを安全に採点できない。

Python / HTML-CSSもschema定義だけが先行している。SQL / Python / HTML-CSSの言語別RunnerはIssue #143で実装する。

## 守る境界

- Runner実装前にSQL / Python / HTML-CSSを対応済みと表示しない。
- Problem JSON由来の任意commandをshellへ直接渡さない。
- hidden test sourceをlearner向けAPI/UIへ返さない。
- Public Challengeはfile-backedを維持する。
- APIでsubmission codeを直接実行しない。
- Submission / processing lease / attempt fencing / outboxを本PRへ混ぜない。
- Production runtimeはSQLite / HTTPのまま。

## 次の確認

1. 最新headの全quality gateを確認する。
2. PR差分をself-reviewする。
3. PR本文へSQL既存不整合・fail-closed・最終CIを記載する。
4. Issue #141 / Notionを同期する。
5. Ready for reviewへ移行する。

## 後続候補

ユーザー価値:

- #143 SQL / Python / HTML-CSS言語別Runner
- Challenge tag検索 / 学習トラック
- おすすめChallenge / 次に解く問題
- 進捗ページの実データ化

基盤依存:

- Submission read / simple write async DatabaseClient移行
- processing lease / attempt fencing async移行
- submission + outbox atomic transaction async移行
