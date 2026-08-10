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
- `language`: javascript / typescript。

未知のenum値はerrorにせず無効条件として扱う。query値をHTMLへ戻す場合は属性値もescapeする。

## 言語公開境界

Problem schemaはJavaScript / TypeScript / Python / SQL / HTML-CSSを定義可能にしているが、現行Worker isolation runnerはChallengeの`runnerConfig.testCommand`を実行せず、visible / hidden test pathを`node --test`へ固定で渡す。

実行契約を確認した結果、現時点で公開Webから提出可能とするのはJavaScript / TypeScriptだけとする。

- javascript: 提出可能
- typescript: Node 22.23.1上で実Challenge contractを確認済み、提出可能
- sql: 既存`sql-monthly-sales`はPython / SQLite test command前提のため採点準備中
- python: Runner未実装
- html-css: Runner未実装

SQL / Python / HTML-CSSはIssue #143で言語別Runner contractを導入し、実Challengeでstarter failure / reference solution successを確認してから提出可能へ移す。

## Fail-closed UI

採点未対応Challengeを既存contentから削除はしない。ただし壊れた採点へ誘導しない。

- 一覧にはChallengeを表示するが、actionを「採点準備中」にする。
- 詳細URLへ直接アクセスしても提出formを表示しない。
- Web `/submit`へ未対応languageを直接POSTしても400で拒否し、APIへforwardしない。
- language filter候補へ未対応languageを表示しない。

この境界はAPI側の最終認可・実行制御を置き換えるものではなく、learner向けWebのfail-closed保護である。言語別Runner導入時にはWorker側でもunsupported languageを実行前に拒否する。

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
- 現行Workerで実行契約を検証できない言語のChallengeは公開提出可能にしない。

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
- Problem JSON由来の任意command stringをWorkerでshell実行する方式へ安易に拡張しない。

## 非対象

- SQL / Python / HTML-CSS Runner本体（Issue #143）
- Public Challenge DB-backed化
- Admin Challengeとのdata source統合
- Submission / lease / outbox変更
- Production DB / queue transport変更
