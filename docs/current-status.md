# current-status（正本）

最終更新: 2026-08-13（Issue #145 / PR #146 Python Remote Runner）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repository: `mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP開発中。
- PR #142はmerge済み。公開Challenge検索・絞り込み、JS/TS実践問題4件、TypeScript実採点を反映済み。
- PR #144は2026-08-13にmerge済み。SQL / HTML-CSS Runner、Python isolated-preview、公開Challenge 9件をmainへ反映済み。
- Issue #145 / PR #146でPython Remote Runner境界とhidden test filesystem isolationを実装中。
- Pythonは引き続きPublic APIでfail-closed拒否する。Actual AWS / staging隔離環境を明示承認付きで検証するまでは公開allowlistへ追加しない。
- Linearは無料Issue上限のため、Issue #145はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Production相当Database provider: SQLite `.data/app.db`。
- Queue transport既定: HTTP。
- Public Challenge Repository: `problems/examples/*/problem.json`のfile-backed実装。
- Admin Challenge Repository: DB-backed / async DatabaseClient。
- Submission / lease / outbox Repository: 同期SQLite固有APIを継続。
- PostgreSQL 18.4 migration / integration基盤は利用可能だが、本番DB切替は未実施。
- RDS / ECS / Secrets ManagerのActual AWS resourceは未作成・未変更。

## Public Challenge / Runner

File-backed Challengeは9件。

| language | Runner | 公開状態 |
| --- | --- | --- |
| JavaScript | `node-test` | 提出可能 |
| TypeScript | `node-test` | 提出可能 |
| SQL | `sqlite-readonly` | 提出可能 |
| HTML/CSS | `html-css-static` | 提出可能 |
| Python | `python-container` via Remote Runner | isolated-preview / 提出不可 |

Python Challenge `python-bugfix-score-buckets`はcontentとして存在するが、Public APIでは400で拒否する。

## PR #146 Python Remote Runner

### 実装済み境界

- `apps/python-runner`をWorkerと分離した専用Remote Runner serviceとして追加。
- WorkerからPython用Docker実行コードを削除し、署名付きHTTP clientだけを保持。
- HMAC SHA-256署名契約を`packages/runner-sdk`へ配置。
- ProductionのRemote Runner URLはHTTPS必須。
- URL credentials / query / fragmentを拒否。
- timestamp / idempotency key / bodyを署名対象にする。
- request / response size、timeout、concurrency、queueを有限化。
- 同一idempotency key + 同一payloadは結果を再利用し、payload差し替えは409拒否。
- Python imageはdigest固定。
- network none / read-only / non-root / cap-drop / no-new-privileges / CPU / memory / pids / fd / timeoutを維持。
- timeout時のcontainer強制削除とlabelによるorphan cleanup境界を追加。
- 提出コード由来のSyntaxError / runtime failure / timeout / protocol failureはterminal grading failureとして0点で終了し、不要なinfra retryを発生させない。
- Docker起動不可など実行基盤側の失敗だけをinfra failureとして扱う。

### Hidden test filesystem isolation

Python Challengeのtest contractを`.py`テスト直接実行からJSON case + trusted comparatorへ変更した。

Python sandboxへmountするのは次だけ。

- `submission.py`
- 汎用`invoke.py`

visible / hidden case定義、期待値、hidden test sourceはRemote Runnerの信頼側Node processだけが保持する。submitted codeから`/workspace`を走査するintegration testでもhidden/test/case fileが見えないことを確認する。

### CIで確認済みの経路

code head `41517264580678372428b8d3df0d4b0e9dff0699`で以下がすべて成功済み。

- Docs validation
- Frozen lockfile install
- Lint
- Typecheck
- Unit test
- Integration test
- Schema validation
- Infra validation
- Build
- PostgreSQL 18.4 integration
- Python starter failure / reference solution success
- submitted codeからhidden test filesystemを参照できないこと
- Worker client → HTTP Remote Runner → actual Docker → Python sandbox
- HMAC不正401
- idempotency payload差し替え409
- SyntaxErrorをterminal 0点として扱うこと
- timeoutをterminal 0点として扱うこと

## Issue #145でまだ未完了の事項

- Actual AWS / staging Remote Runner resource作成。
- Secrets Manager等によるshared secret配布・rotation。
- TLS endpoint / security group / task roleのreview-only IaC。
- stagingでのadversarial code検証。
- 実インフラ上のconcurrency / quota / cost上限確認。
- 複数Remote Runner instanceを跨ぐ重複実行の運用評価。
- 上記完了後のPython Public allowlist有効化。

Actual AWS変更は明示承認なしに実施しない。

## Correctness・セキュリティ境界

- API processでsubmission codeを直接実行しない。
- WorkerへDocker socketを公開しない。
- Problem JSON由来の任意commandをshell実行しない。
- Hidden test source / hidden logsをlearnerへ返さない。
- Unsupported languageをsubmission / outbox永続化前にfail-closed拒否する。
- Submission + queue outbox atomicityを変更しない。
- Processing lease / attempt fencing / completion guardを変更しない。
- ユーザーコード起因failureをinfra retryへ誤分類しない。
- DB cutoverとqueue transport切替を同じchangeへ含めない。
- Production runtimeはSQLite / HTTPを維持する。

## 次の候補

ユーザー価値:

1. Issue #145のreview-only AWS / staging設計と隔離検証。
2. Python Challenge追加（公開gateは維持したままcontentを増やせる）。
3. Challenge tag検索 / 学習トラック。
4. おすすめChallenge / 次に解く問題。
5. 進捗ページの実submissionデータ化。

基盤依存:

1. Submission read / simple writeのasync DatabaseClient移行。
2. Processing lease / attempt fencingのasync移行。
3. Submission + queue outbox atomic transactionのasync移行。
4. API / Worker composition root provider切替。
5. Outbox claim / lease。
6. RDS / Secrets Manager / network IaC。
7. Data migration / staging rehearsal。

## 参照先

- Issue #145: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- PR #146: `https://github.com/mizzz-ivr/ai-code-dojo/pull/146`
- PR #144: `https://github.com/mizzz-ivr/ai-code-dojo/pull/144`
- Python Remote Runner設計: `docs/architecture/python-remote-runner.md`
- Runner設計: `docs/architecture/language-runner-contracts.md`
