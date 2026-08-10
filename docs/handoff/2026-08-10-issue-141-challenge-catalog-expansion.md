# Issue #141 handoff

## 現在地

- Issue: #141
- PR: #142
- Branch: `feat/challenge-catalog-expansion`
- 目的: 公開Challenge catalogの検索性改善とJS/TS実践問題の拡充

## 実装済み

- 公開Challenge 3件 → 7件
- keyword / difficulty / category / language filter
- query stringによるfilter保持
- 0件表示 / 件数表示
- 公開言語候補をJavaScript / TypeScript / SQLに限定
- 詳細画面の`metadata.category`表示修正
- filter unit test
- 新規Challenge content contract integration test
- 子`node --test`から`NODE_TEST_CONTEXT`を除外し、再帰test skipを防止

## 新規Challenge

- `js-refactor-order-summary`
- `js-bugfix-pagination-window`
- `ts-feature-access-policy`
- `ts-refactor-feature-flags`

## 守る境界

- Python / HTML-CSSはschema上の予約だけで、現行公開UIでは対応済みと表示しない。
- Python / HTML-CSS ChallengeをRunner実装前に追加しない。
- hidden test sourceをlearner向けAPI/UIへ返さない。
- Public Challengeはfile-backedを維持する。
- APIでsubmission codeを直接実行しない。
- Submission / processing lease / attempt fencing / outboxを本PRへ混ぜない。
- Production runtimeはSQLite / HTTPのまま。

## 次の確認

1. 最新headのintegration testで新規4問のstarter failure / reference solution successを確認する。
2. 全quality gateを確認する。
3. `docs/current-status.md` / `docs/active-issues.md`を#141へ更新する。
4. PR本文へ最終CIとself-review結果を記載する。
5. Ready for reviewへ移行する。

## 後続候補

ユーザー価値:

- Python Runner + Python Challenge
- HTML/CSS評価Runner + Frontend Challenge
- Challenge tag検索 / 学習トラック
- おすすめChallenge / 次に解く問題
- 進捗ページの実データ化

基盤依存:

- Submission read / simple write async DatabaseClient移行
- processing lease / attempt fencing async移行
- submission + outbox atomic transaction async移行
