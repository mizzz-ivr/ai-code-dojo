# 言語別Runner contract

最終更新: 2026-08-12（Issue #143 / PR #144）

## 目的

Problem schemaで定義できる言語と、Workerが実際に採点できる言語を明確に分離し、Problem JSON由来の任意commandをshell実行せずに言語別Runnerへ安全にdispatchする。

## Runner contract

`packages/runner-sdk/src/runner-contract.mjs`を言語とRunner kindの正本とする。

| language | Runner kind | 公開状態 | 実行方式 |
| --- | --- | --- | --- |
| javascript | `node-test` | 公開 | 既存Node test runner |
| typescript | `node-test` | 公開 | 既存Node test runner |
| sql | `sqlite-readonly` | 公開 | trusted Node test + in-memory SQLite |
| html-css | `html-css-static` | 公開 | trusted Node testによる静的検証 |
| python | `python-container` | isolated-preview | 固定Docker imageによる隔離検証。Public APIでは拒否 |

Web / API / Workerはこのcontractから公開allowlistを取得し、言語許可リストを個別に持たない。

## Dispatch

Workerの処理フローは次のとおり。

1. SubmissionのChallengeをfile-backed Public Challenge Repositoryから取得する。
2. Challenge metadataのsupportedLanguagesとSubmission languageを検証する。
3. `runner-contract.mjs`でRunner kindを解決する。
4. 固定されたRunner実装へdispatchする。
5. visible / hidden結果を内部結果として集約する。
6. learner向け結果ではhidden test source / internal logsを返さない。

Problem JSONの`buildCommand` / `testCommand` / `runCommand`は実行commandとして解釈しない。新しいChallengeでは`runner-managed:*`の説明値を使用する。

## SQL Runner

SQLはユーザー入力をJavaScriptとして実行しない。

- 最大32KiB。
- 単一statementのみ。
- `SELECT` / `WITH`から始まる参照queryのみ。
- DDL / DML、`ATTACH` / `DETACH` / `PRAGMA` / `VACUUM`等を拒否する。
- trusted test側が`node:sqlite`のin-memory DBへfixtureを作成する。
- submitted SQLはそのin-memory DBだけに対して実行する。
- visible / hidden testは別々に実行し、hidden logはlearnerへ返さない。

これは一般SQL sandboxではなく、Challenge用の参照専用SQLite evaluatorである。

## HTML/CSS Runner

HTML/CSSはブラウザやJavaScript runtimeで実行しない。

- submitted HTMLをUTF-8 textとして扱う。
- trusted Node testがHTML構造・CSS rule・アクセシビリティ条件を検証する。
- `<script>`など実行コンテンツを評価しない。
- MVPでは実ブラウザ描画・visual regressionは対象外。

## Python Runner preview

PythonはRunner contractとCI実行環境のみ先行整備し、Public APIではfail-closed拒否する。

固定image:

`python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd`

隔離option:

- `--network none`
- root filesystem read-only
- Challenge workspace read-only mount
- tmpfsのみwrite可能
- `--cap-drop ALL`
- `no-new-privileges`
- UID/GID `65534:65534`
- CPU 0.5
- memory 256MiB
- pids 64
- nofile 64
- host timeout + TERM/KILL
- stdout/stderr capture上限256KiB
- shellを経由せず`python -I -B <trusted-test-path>`の固定argvで起動

## Pythonをまだ公開しない理由

CI上で単発Docker contractを検証できても、本番WorkerでDocker daemonを直接利用する設計をそのまま採用しない。

またPublic化前には、少なくとも以下が必要。

- 専用remote / ECS Task等への隔離実行境界。
- hidden test filesystemをlearner codeから分離する仕組み。
- container lifecycle / orphan cleanup / retry / timeoutの運用契約。
- image digest更新手順と脆弱性対応。
- concurrency / quota / cost上限。
- stagingでの悪意あるcodeを含む負荷・隔離テスト。

したがって本PRではPython Challengeを表示可能なcontentとして追加するが、一覧では「採点準備中」とし、Web / APIからsubmissionを作成できない。

## Hidden test境界

- learner向けChallenge APIはhidden test sourceを返さない。
- learner向けSubmission結果はhidden testの件数・pass/fail集計だけを返す。
- hidden test logは内部結果に限定する。
- Python Public化では、submitted codeからhidden test file自体を読めない実行構造を追加の必須条件とする。

## 既存境界への影響

変更しないもの:

- API processはsubmission codeを直接実行しない。
- Submission + queue outbox atomicity。
- processing lease / attempt fencing / completion guard。
- Public Challengeはfile-backed。
- Admin ChallengeはDB-backed。
- Production DBはSQLite。
- Queue transportはHTTP。

## テスト方針

- Runner contract / public allowlist unit test。
- SQL read-only validator unit test。
- Python container argv / hardening unit test。
- SQL / HTML-CSS starter failure・reference solution success integration。
- SQL / HTML-CSS API → queue → Worker E2E。
- Python Public API 400 fail-closed E2E。
- Python固定container imageをCIでpullし、starter failure / reference solution successを実コンテナで検証。
- learner向け結果にhidden source / internal logが含まれないことを確認する。
