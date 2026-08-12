# 公開Challenge catalog

最終更新: 2026-08-12（Issue #143 / PR #144）

## 目的

学習者が公開Challengeをキーワード・難易度・カテゴリ・言語で絞り込み、実際に採点できる問題へ安全に到達できるようにする。

Problem schema上の「定義可能な言語」と、本番公開境界で「提出可能な言語」は分けて管理する。

## データフロー

1. Public Challenge Repositoryが`problems/examples/*/problem.json`を読む。
2. API `/api/challenges`がslug / title / difficulty / category / supportedLanguagesを返す。
3. Web `/`がsummaryへfilterを適用する。
4. GET query stringへfilter条件を保持する。
5. 詳細画面はRunner public allowlistを確認して提出formを表示する。
6. APIはsubmission / outbox永続化前にChallenge存在・slug・language・Runner可否を再検証する。
7. Workerも同じpolicyを再確認し、Submission languageをRunner dispatchへ明示的に渡す。

## Filter contract

- `q`: title / slug部分一致。前後空白除去、最大80文字。
- `difficulty`: easy / medium / hard。
- `category`: bugfix / feature / sql / refactor。
- `language`: javascript / typescript / sql / html-css。

Pythonはcontentとして存在するが、Issue #145完了まではlanguage filter候補へ含めない。

未知enum値はerrorにせず無効条件として扱う。query値をHTML属性へ戻す際はescapeする。

## 言語公開境界

正本: `packages/runner-sdk/src/runner-contract.mjs`。

- javascript: 提出可能。
- typescript: 提出可能。
- sql: PR #144 merge後に提出可能。`sqlite-readonly`固定Runner。
- html-css: PR #144 merge後に提出可能。`html-css-static`固定Runner。
- python: `python-container` contractは存在するがisolated-preview。Public submission不可。

Web / API / Workerで別々のallowlistを持たない。

## Challenge数

PR #142 merge後: 7件。

PR #144で2件追加:

- `html-css-feature-profile-card`: medium / feature / HTML-CSS。
- `python-bugfix-score-buckets`: medium / bugfix / Python。採点準備中。

PR #144 merge後: 9件。

既存`sql-monthly-sales`はcontentを残したまま、実採点可能なSQL test contractへ更新する。

## SQL Challenge contract

- Submitted SQLをshellやJavaScriptとして実行しない。
- 最大32KiB。
- 単一statement。
- `SELECT` / `WITH`のみ。
- DDL / DML、`ATTACH` / `DETACH` / `PRAGMA` / `VACUUM`等を拒否。
- trusted Node testが`node:sqlite`のin-memory DBへfixtureを構築する。
- starter failure / reference solution successをintegrationで確認する。

## HTML/CSS Challenge contract

- Submitted HTML/CSSをブラウザで実行しない。
- trusted Node testがHTML構造・CSS rule・アクセシビリティ条件を静的検証する。
- `html-css-feature-profile-card`ではarticle / h2 / alt / CSS Grid / responsive media query等を確認する。
- starter failure / reference solution successをintegrationで確認する。

## Python Challenge contract

`python-bugfix-score-buckets`をcontentとして追加するが、Public submissionは拒否する。

CIでは固定Docker imageを実pullし、resource制限付きcontainerでstarter failure / reference solution successを確認する。

Public化にはIssue #145が必要。

特に、submitted codeからhidden test file自体を読めないfilesystem isolationを必須条件とする。

## Fail-closed境界

### Web

- Runner未公開Challengeは一覧で「採点準備中」と表示する。
- 詳細画面でsubmit formを表示しない。
- `/submit`への直接POSTも拒否する。
- 未公開languageをfilter候補へ表示しない。

### API

Submission / outbox永続化前に以下を検証する。

- safe slug `^[a-z0-9-]+$`。
- Challenge存在。
- request slugとProblem metadata.slug一致。
- request languageがsupportedLanguagesに含まれる。
- languageがpublic Runner allowlistに含まれる。
- `networkAccess: disabled`。

### Worker

- Challenge読込後に同じpolicyを再確認する。
- legacy / internal queue経路でもunsupported languageを採点しない。
- APIで検証済みの`submission.language`をRunnerへ明示的に渡す。

## Challenge追加ルール

- Problem schema validation成功。
- editable starterあり。
- visible / hidden test分離。
- starterは未解決状態。
- reference solutionでvisible / hidden成功。
- `networkAccess: disabled`。
- hidden test sourceをlearnerへ露出しない。
- Problem JSONのcommand文字列を実行契約に使わない。
- Runnerが未公開なら提出導線を出さない。

## テスト

PR #144では以下をCIで確認する。

- Runner contract / allowlist unit test。
- SQL read-only validator unit test。
- Python container hardening argv unit test。
- SQL / HTML-CSS starter failure・reference solution success。
- SQL / HTML-CSS API → queue → Worker E2E。
- Python Public API 400 fail-closed。
- Python固定container imageの実pull / 実行。
- learner向け結果へhidden source / internal logを返さない。
- 複数対応ChallengeでもSubmission languageをRunner選択に使う。

## セキュリティ・correctness

- API processでsubmission codeを直接実行しない。
- Problem JSON由来の任意commandをshell実行しない。
- Hidden testsをlearnerへ返さない。
- SQL / HTML-CSSの追加でSubmission + outbox atomicityを変更しない。
- Processing lease / attempt fencing / completion guardを変更しない。
- Pythonは本番隔離基盤完成前に公開しない。
- Production DB / queue transportはSQLite / HTTPを維持する。

## 後続

- Issue #145: Python Runner本番隔離実行基盤。
- Challenge tag検索 / 学習トラック。
- おすすめChallenge / 次に解く問題。
- 進捗ページの実submissionデータ化。
