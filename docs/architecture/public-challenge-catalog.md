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

## 言語公開・実行境界

Problem schemaはJavaScript / TypeScript / Python / SQL / HTML-CSSを定義可能にしているが、現行Node系runnerが安全に処理できることを確認できた言語だけを提出可能にする。

採点可能言語は`packages/runner-sdk/src/language-policy.mjs`を正本とし、Web / API / Workerで同じallowlistを使用する。

- javascript: 提出可能
- typescript: Node 22.23.1でAPI → queue → Worker → visible / hidden testまでE2E確認済み、提出可能
- sql: 既存`sql-monthly-sales`はPython / SQLite test command前提のため採点準備中
- python: Runner未実装
- html-css: Runner未実装

SQL / Python / HTML-CSSはIssue #143で言語別Runner contractを導入し、実Challengeでstarter failure / reference solution successを確認してから提出可能へ移す。

## Fail-closed境界

採点未対応Challengeを既存contentから削除はしない。ただし壊れた採点へ誘導しない。

### Web

- 一覧にはChallengeを表示するが、actionを「採点準備中」にする。
- 詳細URLへ直接アクセスしても提出formを表示しない。
- Web `/submit`へ未対応languageを直接POSTしても400で拒否し、APIへforwardしない。
- language filter候補へ未対応languageを表示しない。

### API

Submission永続化 / outbox作成より前に次を検証する。

- `challengeSlug`がProblem schemaと同じ`^[a-z0-9-]+$`を満たす。
- Challengeが実在する。
- Problem定義のslugとrequest slugが一致する。
- request languageがChallengeのsupportedLanguagesに含まれる。
- Challengeの言語が共通Runner allowlistに含まれる。

これにより、SQL Challengeを`language=javascript`として偽装するrequestも拒否する。入力不正を理由にsubmission / outboxのatomic transaction自体は変更しない。

### Worker

WorkerもChallenge読込後に同じ`canSubmitChallengeLanguage()`を適用する。API以前に作成されたlegacy submissionや内部queue投入でも、unsupported languageを採点処理へ進めずterminal failureとして扱う。

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

## Test contract

新規4問ではstarter failure / reference solution successを独立Node test processで確認する。

さらにTypeScriptについては実API-flowで以下を確認する。

1. `/api/submissions`が201を返す。
2. queue経由でWorkerへ配送される。
3. WorkerがTypeScript starter fileへsubmission codeを書き込む。
4. Node 22.23.1でvisible / hidden testが成功する。
5. learner responseへhidden source / internal logsを露出しない。

既存infra failure integrationは、不正ChallengeをPublic APIから作成する旧fixtureを廃止し、Repositoryで内部fixtureを作成してWorkerへqueue messageを送る。これによりPublic APIの存在検証を弱めず、retry / infra_failed契約も維持する。

## セキュリティ・correctness

- API processでsubmission codeを直接実行しない。
- learnerへhidden test sourceを返さない。
- catalog filterは実行コードやSQLへ変換しない。
- query値はHTML出力前にescapeする。
- 未知filter値を500要因にしない。
- 公開UIが採点不能言語を対応済みと誤認させない。
- Web / API / Workerでrunner allowlistを共通化する。
- Problem JSON由来の任意command stringをWorkerでshell実行する方式へ安易に拡張しない。
- Submission + queue outbox atomicityを変更しない。

## 非対象

- SQL / Python / HTML-CSS Runner本体（Issue #143）
- Public Challenge DB-backed化
- Admin Challengeとのdata source統合
- Submission Repositoryのasync DatabaseClient移行
- Production DB / queue transport変更
