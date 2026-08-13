# current-status（正本）

最終更新: 2026-08-12（Issue #143 / PR #144 言語別Runner contract）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repository: `mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP開発中。
- PR #142は2026-08-12にmerge済み。公開Challenge検索・絞り込み、JS/TS実践問題4件、TypeScript実採点をmainへ反映済み。
- Issue #143 / PR #144で言語別Runner contractを実装中。
- Public Challengeは7件から9件へ拡充予定。
- SQL / HTML-CSSはPR #144で公開提出可能にする。
- PythonはChallengeと隔離Runner contractを追加するが、本番隔離基盤が未整備のためPublic APIではfail-closed拒否する。
- Python本番公開はIssue #145で後続管理する。
- Linearは無料Issue上限のため、Issue #143 / #145はGitHub Issue / Repository docsを管理正本とする。

## 現行runtime

- Production相当Database provider: SQLite `.data/app.db`。
- Queue transport既定: HTTP。
- Public Challenge Repository: `problems/examples/*/problem.json`のfile-backed実装。
- Admin Challenge Repository: DB-backed / async DatabaseClient。
- Submission / lease / outbox Repository: 同期SQLite固有APIを継続。
- PostgreSQL 18.4のmigration / integration基盤は利用可能だが、本番DB切替は未実施。
- RDS / ECS / Secrets Managerの本番resourceは未作成。

## Public Challenge

PR #142 merge後: 7件。

PR #144追加:

- `html-css-feature-profile-card`: medium / feature / HTML-CSS。
- `python-bugfix-score-buckets`: medium / bugfix / Python。公開提出はまだ不可。

PR #144 merge後のfile-backed content: 9件。

既存`sql-monthly-sales`はPR #144で安全なSQLite evaluatorへ移行し、提出可能化する。

## 言語別Runner contract

正本: `packages/runner-sdk/src/runner-contract.mjs`。

| language | Runner | 公開状態 |
| --- | --- | --- |
| JavaScript | `node-test` | 提出可能 |
| TypeScript | `node-test` | 提出可能 |
| SQL | `sqlite-readonly` | PR #144 merge後に提出可能 |
| HTML/CSS | `html-css-static` | PR #144 merge後に提出可能 |
| Python | `python-container` | isolated-preview / 提出不可 |

Web / API / Workerは同じRunner contractからpublic allowlistを取得する。

WorkerはAPIで検証済みの`submission.language`をRunnerへ明示的に渡し、ChallengeのsupportedLanguages先頭要素へ暗黙依存しない。

## SQL Runner

- Submitted SQLをJavaScriptやshellとして実行しない。
- 単一statement、最大32KiB。
- `SELECT` / `WITH`のみ許可。
- DDL / DML、`ATTACH` / `DETACH` / `PRAGMA` / `VACUUM`等を拒否。
- trusted Node testが`node:sqlite`のin-memory DBへfixtureを作成して評価する。
- visible / hidden testを分離し、hidden logをlearnerへ返さない。

## HTML/CSS Runner

- Submitted HTML/CSSをブラウザやJavaScriptとして実行しない。
- trusted Node testから静的構造・CSS rule・アクセシビリティ条件を検証する。
- MVPではbrowser rendering / visual regressionは対象外。

## Python Runner preview

固定image:

`python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd`

CIでは実Docker containerでstarter failure / reference solution successを検証する。

隔離option:

- network none。
- read-only root filesystem / workspace。
- tmpfsのみwrite可能。
- capability全削除。
- `no-new-privileges`。
- non-root UID/GID `65534:65534`。
- CPU / memory / pids / file descriptor上限。
- host timeout + TERM/KILL。
- stdout/stderr 256KiB上限。
- shellを経由しない固定argv。

ただし本番WorkerへDocker socketを渡す設計は採用しない。Submitted codeからhidden test file自体を読めないfilesystem isolationも必要なため、PythonはIssue #145完了まで公開allowlistへ追加しない。

## PR #144の検証状況

Code head `a7c99aad7e26044c943bb423bcfd01f1d87c572d`で以下を確認済み。

- Docs validation: Success。
- Frozen lockfile install: Success。
- Lint: Success。
- Typecheck: Success。
- Unit test: Success。
- Integration test: Success。
- PostgreSQL 18.4 service integration: Success。
- SQL starter failure / reference solution success: Success。
- HTML/CSS starter failure / reference solution success: Success。
- SQL / HTML-CSS API → queue → Worker E2E: Success。
- Python Public API 400 fail-closed: Success。
- Python固定Docker image pull + 実container contract: Success。
- Schema validation: Success。
- Infra validation: Success。
- Build: Success。

## 実装中に検出・修正した事項

1. 存在しない`python:3.14.6-alpine3.22`指定を検出し、実pull確認済みの3.14.5 image digest固定へ変更。
2. PR #142由来の「SQLは拒否する」旧unit testを、SQL解禁 / language spoof拒否 / Python fail-closed契約へ更新。
3. Node系Runnerのvisible / hidden timeoutに対しintegration polling窓が不足していたため、既存fixtureを変更せずpolling上限のみ拡張。
4. 自己レビューでPython Runnerの出力無制限・権限制約不足を検出し、capture上限・非root・capability drop・no-new-privileges等を追加。
5. WorkerがSubmission languageをRunnerへ渡さずChallenge先頭languageを推測していたため、明示的に`submission.language`を渡し、複数対応Challengeの回帰テストを追加。

## Correctness・セキュリティ境界

- API processでsubmission codeを直接実行しない。
- Problem JSON由来の任意`testCommand` / `runCommand`をshell実行しない。
- Hidden test source / hidden logsをlearnerへ返さない。
- Unsupported languageをsubmission / outbox永続化前にfail-closed拒否する。
- Workerでも同じlanguage policyを再確認する。
- Submission + queue outbox atomicityを変更しない。
- Processing lease / attempt fencing / completion guardを変更しない。
- DB cutoverとqueue transport切替を同じchangeへ含めない。
- Production runtimeはSQLite / HTTPを維持する。

## 次の候補

ユーザー価値:

1. Issue #145: Python Runner本番隔離実行基盤。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページの実submissionデータ化。

基盤依存:

1. Submission read / simple writeのasync DatabaseClient移行。
2. Processing lease / attempt fencingのasync移行。
3. Submission + queue outbox atomic transactionのasync移行。
4. API / Worker composition root provider切替。
5. Outbox claim / lease。
6. RDS / Secrets Manager / network IaC。
7. Data migration / staging rehearsal。

## 参照先

- PR #142: `https://github.com/mizzz-ivr/ai-code-dojo/pull/142`
- Issue #143: `https://github.com/mizzz-ivr/ai-code-dojo/issues/143`
- PR #144: `https://github.com/mizzz-ivr/ai-code-dojo/pull/144`
- Issue #145: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- Runner設計: `docs/architecture/language-runner-contracts.md`
- Public catalog: `docs/architecture/public-challenge-catalog.md`
