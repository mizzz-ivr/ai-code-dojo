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
- `runner-sdk`へJS/TS共通language policyを追加
- Web / API / Workerで同じrunner allowlistを利用
- API submission作成前にChallenge存在・slug・languageを検証
- SQL等の未対応languageをsubmission / outbox永続化前に拒否
- Workerでもlegacy/internal queue経路をfail-closed
- TypeScriptをAPI → queue → Worker → visible / hidden testsまでE2E確認
- filter / runnability / submission target unit test
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

## 発見・修正した既存課題

### SQL

`sql-monthly-sales`はProblem JSONでPython / SQLite commandを定義しているが、現行Node系runnerはそのcommandを実行しないためSQLを安全に採点できない。

SQL / Python / HTML-CSSの言語別RunnerはIssue #143で実装する。PR #142では削除せず「採点準備中」としてfail-closedにする。

### TypeScript

Workerは従来`language !== 'javascript'`を明示拒否していた。Node 22でTypeScript testが実行可能でも本番経路では拒否されるため、Worker判定を共通runner policyへ移行し、TypeScriptを実E2Eで確認した。

### Infra failure test fixture

旧integrationは存在しないChallengeをPublic APIから作成してWorker障害を誘発していた。API存在検証を弱めず、内部Repositoryでfixtureを作成し正規queue messageとしてWorkerへ投入する方式へ変更した。

## 守る境界

- Runner実装前にSQL / Python / HTML-CSSを対応済みと表示しない。
- Problem JSON由来の任意commandをshellへ直接渡さない。
- hidden test sourceをlearner向けAPI/UIへ返さない。
- Public Challengeはfile-backedを維持する。
- APIでsubmission codeを直接実行しない。
- Submission + outbox atomic transactionを変更しない。
- processing lease / attempt fencing / completion guardを変更しない。
- Production runtimeはSQLite / HTTPのまま。

## 確認済みquality gate

Code head `670bca84bb8a7dcabf84a68687493ee8cbaa6378`で以下を確認済み。

- Lint: Success
- Typecheck: Success
- Unit test: Success
- Integration test: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success
- TypeScript API → Worker E2E: Success

最新docs headでも最終CIを再確認してからReadyへ移行する。

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
