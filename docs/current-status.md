# current-status（正本）

最終更新: 2026-08-14（Issue #147 Python Runner staging review-only IaC）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repository: `mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP開発中。
- PR #142はmerge済み。公開Challenge検索・絞り込み、JS/TS実践問題4件、TypeScript実採点を反映済み。
- PR #144は2026-08-13にmerge済み。SQL / HTML-CSS Runner、Python isolated-preview、公開Challenge 9件をmainへ反映済み。
- PR #146は2026-08-14にmerge済み。Python Remote Runner境界、hidden test filesystem isolation、user-code failureのterminal grading分類をmainへ反映済み。
- Parent Issue #145はOpenのまま。Actual staging isolation / adversarial test / cost gate / Python公開判定が残る。
- Issue #147でPython Remote Runnerのreview-only AWS/staging IaCを実装中。
- Pythonは引き続きPublic APIでfail-closed拒否する。Actual staging検証完了までは公開allowlistへ追加しない。
- Linearは無料Issue上限のため、Issue #147はGitHub Issue / Repository docs / Notionを管理正本とする。

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

## PR #146 Python Remote Runner（完了済み）

- `apps/python-runner`専用service。
- WorkerからPython Docker実行を削除し、HMAC署名付きHTTP clientへ分離。
- Production Remote URLはHTTPS必須。
- HMAC契約を`packages/runner-sdk`へ共通化。
- request / response size、timeout、concurrency、queue、idempotencyを有限化。
- fixed Python image digest、network none、read-only、non-root、cap-drop、no-new-privileges、resource limitを維持。
- Python sandboxへ`submission.py`と汎用`invoke.py`だけをmountし、hidden case / expected valueをtrusted Node processへ隔離。
- SyntaxError / runtime failure / timeout / protocol failureはterminal 0点とし、user-code由来の不要なinfra retryを防止。
- Docker起動不可など実行基盤failureだけをinfra retry対象とする。

merge commit: `914f546039c8a4bdf731be0f230e9993e0dbed12`

## Issue #147 Python Runner staging review-only IaC

### 実装対象

- `infra/aws/cloudformation/python-runner-staging-stack.json`
- dedicated ECS/EC2 Runner host
- Auto Scaling group Min/Max/Desired=1
- ECS service DesiredCount=1
- internal ALB + HTTPS 443
- private Route53 alias
- Secrets Manager generated HMAC secret
- Runner Client / ALB / Host専用Security Group
- Runner task execution role
- CloudWatch Logs
- Docker socket / shared workspace host bind mount
- Repository独自CloudFormation validator + unit test
- architecture / runbook / handoff

### Fargateを使わない理由

現行Remote Runnerはhost Docker daemonと`host.sourcePath` bind mountを必要とするため、Fargateへ単純配置するとruntime contractを満たさない。Issue #147では専用ECS/EC2 hostに限定し、Docker socket root-equivalent権限をWorkerや他workloadへ拡散させない。

### Review-only gate

- CI / Repository操作からAWS resourceを作成しない。
- Actual AWS changeはchange setレビューとユーザーの明示承認後だけ。
- Python Public gateはOFFのまま。
- staging WorkerへのRunner Client SG / URL / secret wiringはActual deploy段階の別作業。

## Issue #145でまだ未完了の事項

- Issue #147 review-only IaCのmerge。
- AWS `validate-template` / change set review。
- ユーザー明示承認後のActual staging deploy。
- WorkerへのRunner Client SG / private URL / shared secret wiring。
- stagingでのadversarial code検証。
- 実インフラ上のconcurrency / quota / cost上限確認。
- secret rotation手順。
- 複数Remote Runner instanceを跨ぐ重複実行の運用評価。
- 上記完了後のPython Public allowlist有効化判断。

Actual AWS変更は明示承認なしに実施しない。

## Correctness・セキュリティ境界

- API processでsubmission codeを直接実行しない。
- WorkerへDocker socketを公開しない。
- Docker socketを使用する場合は専用Runner host境界だけに限定する。
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

1. Python Challenge追加（公開gateは維持したままcontentを増やす）。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページの実submissionデータ化。

Issue #145 gate:

1. Issue #147 merge。
2. review-only change set確認。
3. 明示承認後のstaging deploy / adversarial test。
4. Python Public gate判定。

基盤依存:

1. Submission read / simple writeのasync DatabaseClient移行。
2. Processing lease / attempt fencingのasync移行。
3. Submission + queue outbox atomic transactionのasync移行。
4. API / Worker DB provider切替。
5. Outbox claim / lease。
6. RDS / Secrets Manager / network IaC。
7. Data migration / staging rehearsal。

## 参照先

- Parent Issue #145: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- Issue #147: `https://github.com/mizzz-ivr/ai-code-dojo/issues/147`
- PR #146: `https://github.com/mizzz-ivr/ai-code-dojo/pull/146`
- Python Remote Runner設計: `docs/architecture/python-remote-runner.md`
- Python Runner staging AWS設計: `docs/architecture/python-runner-staging-aws.md`
- Python Runner staging runbook: `docs/runbooks/2026-08-14-python-runner-staging-iac.md`
