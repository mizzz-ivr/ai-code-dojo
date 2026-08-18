# current-status（正本）

最終更新: 2026-08-17（Issue #149 / PR #150 Python Runner service image）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repository: `mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP開発中。
- PR #142 merge済み。公開Challenge検索・絞り込み、JS/TS実践問題、TypeScript実採点を反映済み。
- PR #144 merge済み。SQL / HTML-CSS Runner、Python isolated-preview、公開Challenge 9件を反映済み。
- PR #146 merge済み。Python Remote Runner、hidden test filesystem isolation、HMAC、idempotency、resource hardeningを反映済み。
- PR #148は2026-08-17にmerge済み。Python Remote Runnerのreview-only staging AWS IaCをmainへ反映済み。
- Issue #147はPR #148 mergeで完了済み。
- Issue #149 / PR #150でPython Runner service imageの再現可能build・実Docker E2E・SBOM・脆弱性gateを実装中。
- Parent Issue #145はOpenのまま。Actual staging deploy / adversarial test / cost gate / Python公開判定が残る。
- Pythonは引き続きPublic APIでfail-closed拒否する。Actual staging検証完了までは公開allowlistへ追加しない。
- Linearは無料Issue上限のため、Issue #149はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Production相当Database provider: SQLite `.data/app.db`。
- Queue transport既定: HTTP。
- Public Challenge Repository: `problems/examples/*/problem.json`のfile-backed実装。
- Admin Challenge Repository: DB-backed / async DatabaseClient。
- Submission / lease / outbox Repository: 同期SQLite固有APIを継続。
- PostgreSQL 18.4 migration / integration基盤は利用可能だが、本番DB切替は未実施。
- RDS / ECS / ECR / Secrets ManagerのActual AWS resourceは、このPython Runner staging作業では作成・変更していない。

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
- request / response size、timeout、concurrency、queue、idempotencyを有限化。
- fixed Python sandbox image、network none、read-only、non-root、cap-drop、no-new-privileges、resource limitを維持。
- Python sandboxへ`submission.py`と汎用`invoke.py`だけをmountし、hidden case / expected valueをtrusted Node processへ隔離。
- SyntaxError / runtime failure / timeout / protocol failureはterminal 0点とし、user-code由来の不要なinfra retryを防止。

merge commit: `914f546039c8a4bdf731be0f230e9993e0dbed12`

## PR #148 staging review-only IaC（完了済み）

- dedicated ECS/EC2 Runner host。
- ASG Min/Max/Desired=1。
- ECS service DesiredCount=1。
- internal ALB + HTTPS 443。
- private Route53 alias。
- Secrets Manager generated HMAC secret。
- Runner Client / ALB / Host専用Security Group。
- Docker socket / shared workspace host bind mount。
- IMDSv2 required、public IP / SSHなし、encrypted gp3。
- Repository validatorでFargate化、public ingress、capacity拡大、plaintext secret、IAM拡大等をfail-closed拒否。
- Actual AWS resourceは作成していない。

merge commit: `8f6b4c9b5ffb535928b59acc927b507fd1e56462`

## Issue #149 / PR #150 Python Runner service image

### 実装済み

- `apps/python-runner/Dockerfile`を追加。
- Node.js `22.23.1-alpine3.24`をdigest固定。
- Docker CLI `29.6.2-cli-alpine3.24`をdigest固定。
- runtimeからnpm / npx / yarnを除去。
- service imageへ`apps/python-runner`、`packages/runner-sdk`、Python採点に必要なtrusted runtime dataだけを配置。
- Python Challenge runtime packagerを追加し、`problem.json`、visible case JSON、hidden case JSONだけをimageへ含める。
- starter code、旧hidden `.py` test source、他言語Challenge、Repository docs / git metadataをruntime imageへ含めない。
- case path traversalとsymlinkをfail-closed拒否するunit testを追加。
- CIでservice containerをread-only / cap-drop ALL / no-new-privilegesとして起動。
- containerized Runner → host Docker socket → pinned Python sandbox → reference submission 100点のE2Eを追加。
- CycloneDX SBOMとTrivy JSON reportをworkflow artifactとして生成。
- HIGH / CRITICAL vulnerabilityを原則CI failureにする。

### Trivy例外

初回scanではCRITICAL 0件、HIGH 8件を検出した。8件はすべてDocker CLI binary内のGo stdlib `1.26.5`由来。

現時点で利用可能なstable Docker CLI / Go upstreamでは解消版へ更新できないため、次の条件をすべて固定した期限付き例外だけを許可する。

- CVE ID: 承認済み8件のみ。
- path: `usr/local/bin/docker`のみ。
- PURL: `pkg:golang/stdlib@v1.26.5`のみ。
- expiry: `2026-09-17`。
- unknown CVE追加、PURL wildcard化、期限延長はvalidator / unit testで拒否する。

raw Trivy reportは例外適用前の情報をartifactとして残し、レビュー可能にする。

## Issue #145でまだ未完了の事項

- PR #150 merge。
- ECR repository / image publish / digest release contractのreview-only設計。
- AWS `validate-template` / change set review。
- ユーザー明示承認後のActual staging deploy。
- WorkerへのRunner Client SG / private URL / shared secret wiring。
- staging adversarial code検証。
- 実インフラ上のconcurrency / quota / cost上限確認。
- secret rotation / rollback手順確認。
- 複数Remote Runner instanceを跨ぐ重複実行の運用評価。
- 上記完了後のPython Public allowlist有効化判断。

Actual AWS変更は明示承認なしに実施しない。

## Correctness・セキュリティ境界

- API processでsubmission codeを直接実行しない。
- WorkerへDocker socketを公開しない。
- Docker socket root-equivalent権限は専用Runner host / control-planeだけに限定する。
- submitted Python codeはnon-root sandboxで実行する。
- Hidden test source / hidden logsをlearnerへ返さない。
- service image内のhidden case JSONはtrusted Runner用であり、Python sandbox filesystemへmountしない。
- Problem JSON由来の任意commandをshell実行しない。
- Submission + queue outbox atomicityを変更しない。
- Processing lease / attempt fencing / completion guardを変更しない。
- ユーザーコード起因failureをinfra retryへ誤分類しない。
- DB cutoverとqueue transport切替を同じchangeへ含めない。
- Production runtimeはSQLite / HTTPを維持する。

## 次の候補

Runner staging gate:

1. PR #150 merge。
2. ECR image publish / digest release contractをreview-onlyで実装。
3. review-only AWS change set確認。
4. 明示承認後のstaging deploy / adversarial test。
5. Python Public gate判定。

ユーザー価値:

1. Python Challenge追加。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページの実submissionデータ化。

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
- Issue #149: `https://github.com/mizzz-ivr/ai-code-dojo/issues/149`
- PR #150: `https://github.com/mizzz-ivr/ai-code-dojo/pull/150`
- Python Remote Runner設計: `docs/architecture/python-remote-runner.md`
- Python Runner staging AWS設計: `docs/architecture/python-runner-staging-aws.md`
- Python Runner service image設計: `docs/architecture/python-runner-service-image.md`
- Python Runner service image runbook: `docs/runbooks/2026-08-17-python-runner-service-image.md`
