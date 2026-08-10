# 公開Challenge catalog

最終更新: 2026-08-10（Issue #141 / PR #142）

## 目的

学習者が公開Challengeをキーワード・難易度・カテゴリ・言語で絞り込み、取り組みたい問題へ短時間で到達できるようにする。

同時に、Problem schema上の「定義可能な言語」と現行Workerで「実際に採点可能な言語」を混同しない。

## 現行データフロー

1. Public Challenge Repositoryが`problems/examples/*/problem.json`を読み込む。
2. API `/api/challenges`はsummaryとしてslug / title / difficulty / category / supportedLanguagesを返す。
3. Web `/`は既存summaryを取得し、Web process内でfilterを適用する。
4. filter条件はGET query stringに保持する。
5. API contractとPublic Challenge Repositoryのdata sourceは変更しない。

## Filter contract

Query parameter:

- `q`: title / slugの部分一致。前後空白を除去し最大80文字。
- `difficulty`: easy / medium / hard。
- `category`: bugfix / feature / sql / refactor。
- `language`: javascript / typescript / sql。

未知のenum値はerrorにせず無効条件として扱う。query値をHTMLへ戻す場合は属性値もescapeする。

## 言語公開境界

Problem schema自体は`python`と`html-css`も予約しているが、現行Worker isolation runnerはNode test runnerを使用している。

そのため公開catalogの言語filterへ表示するのは、現時点で採点可能性を確認できる次の3言語だけとする。

- javascript
- typescript
- sql

Python / HTML-CSSはRunner実装と実行契約テストが完了するまで、対応済みとして公開UIへ表示しない。

## Challenge追加ルール

新規Challengeは最低限以下を満たす。

- Problem schema validationが成功する。
- editable starterが存在する。
- visible testsとhidden testsを分離する。
- starter状態では少なくとも1つのtestに失敗する。
- reference solutionでvisible / hidden testsをすべて通過できる。
- `networkAccess: disabled`を維持する。
- hidden test内容をlearner向けAPI/UIへ露出しない。
- 既存Challengeを書き換えず、新しいslugで追加する。

## Issue #141で追加するChallenge

- `js-refactor-order-summary`: medium / refactor / JavaScript。入力非破壊性。
- `js-bugfix-pagination-window`: hard / bugfix / JavaScript。境界値。
- `ts-feature-access-policy`: medium / feature / TypeScript。deny-first認可優先順位。
- `ts-refactor-feature-flags`: hard / refactor / TypeScript。undefinedとfalseの区別、設定優先順位。

## セキュリティ・correctness

- API processでsubmission codeを直接実行しない。
- learnerへhidden test sourceを返さない。
- catalog filterは実行コードやSQLへ変換しない。
- query値はHTML出力前にescapeする。
- 未知filter値を500要因にしない。
- 公開UIが採点不能言語を対応済みと誤認させない。

## 非対象

- Python / HTML-CSS Runner
- Public Challenge DB-backed化
- Admin Challengeとのdata source統合
- Submission / lease / outbox変更
- Production DB / queue transport変更
