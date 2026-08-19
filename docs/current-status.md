# current-status（正本）

最終更新: 2026-08-19（Issue #153 / PR #154 Python Runner staging change set review）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repository: `mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP開発中。
- PR #142 / #144 / #146 / #148 / #150 / #152はmerge済み。
- PR #152は2026-08-19にmerge済み。Python Runner private ECR publish / immutable digest release contractをmainへ反映済み。
- Issue #151はPR #152 mergeでCompleted。
- Issue #153 / PR #154で、validated release manifestからPython Runner staging CloudFormation change setをreview-only生成する経路を実装中。
- Parent Issue #145はOpen。Actual AWS bootstrap / image publish / change set review・execute / staging deploy / adversarial test / Python公開判定が残る。
- Python Public submissionは引き続きOFF / fail-closed。
- Linearは無料Issue上限のためIssue #153はGitHub Issue / Repository docsを管理正本とする。

## 現行runtime

- Production相当Database provider: SQLite `.data/app.db`。
- Queue transport既定: HTTP。
- Public Challenge Repository: file-backed。
- Admin Challenge Repository: DB-backed / async DatabaseClient。
- Submission / lease / outbox Repository: 同期SQLite固有APIを継続。
- PostgreSQL 18.4 migration / integration基盤は利用可能だが、本番DB切替は未実施。
- RDS / ECS / ECR / Secrets ManagerのActual AWS resourceは今回のreview-only実装では作成・変更していない。

## Public Challenge / Runner

| language | Runner | 公開状態 |
| --- | --- | --- |
| JavaScript | `node-test` | 提出可能 |
| TypeScript | `node-test` | 提出可能 |
| SQL | `sqlite-readonly` | 提出可能 |
| HTML/CSS | `html-css-static` | 提出可能 |
| Python | Remote Runner + isolated Docker sandbox | isolated-preview / 提出不可 |

Python Challengeはcontentとして存在するが、Public APIでは拒否する。

## 完了済みPython Runner基盤

### PR #146 Remote Runner

- WorkerからPython Docker実行責務を専用`apps/python-runner`へ分離。
- HMAC / idempotency / finite timeout / concurrency / queue。
- hidden test filesystem isolation。
- submitted codeはnetworkなし・read-only・non-root sandbox。

### PR #148 staging review-only IaC

- dedicated ECS/EC2 Runner host。
- internal ALB / private DNS / Secrets Manager /専用SG。
- Docker socket / shared workspaceはdedicated host境界だけ。
- Actual AWS resourceは未作成。

### PR #150 service image build・scan

- Node.js / Docker CLIをdigest固定。
- trusted Python runtime dataだけをservice imageへpackage。
- nested Docker E2E、CycloneDX SBOM、raw Trivy、HIGH / CRITICAL gate。
- 承認済みDocker CLI由来HIGH 8件だけを2026-09-17まで狭く期限付き許可。

merge commit: `eb13f0b204ef6d34ce0c47327e7f76289c274988`

### PR #152 ECR release contract

- repository `ai-code-dojo-staging-python-runner`固定。
- tag完全IMMUTABLE / scan-on-push / AES256 / Retain。
- dedicated OIDC publisher roleは対象repositoryのpush/readbackだけ。
- manual publishはmain +固定フレーズ手入力 + dedicated Environment。
- OIDC session 900秒、long-lived AWS keyなし。
- `sha-<full source commit>` tagを使用し、既存tagを拒否。
- publish前にbuild / runtime contract / SBOM / Trivy gateを再実行。
- registry digestをreadbackし、source commit / tag / `repository@sha256:digest`をrelease manifestへ固定。
- manifest JSON + SHA-256 checksumをartifact保存。
- Actual ECR repository作成・image pushは未実施。

merge commit: `31432fde4695e17582dcea997a0a6bef772fee45`

## Issue #153 / PR #154 staging change set review contract

### release identity gate

AWS credential取得前に次をfail-closed検証する。

- 入力はrelease workflow run IDのみ。任意image URI / digestは受け取らない。
- selected runは`publish-python-runner-staging-image` / `workflow_dispatch` / `main` / Successのみ。
- selected runの`head_sha`からexact artifact名を算出する。
- そのrun内に未期限artifactがちょうど1つ存在することを確認する。
- artifactはmanifest + checksumの2ファイルだけを許可する。
- SHA-256 checksumとrelease manifest schemaを検証する。
- manifest `sourceCommit`とpublish run `head_sha`を一致させる。
- release source commitが現在mainのancestorであることを要求する。古いmain releaseのrollback利用は可能だが、PR未merge commit由来releaseは拒否する。

### deterministic staging parameters

validated release manifestとGitHub Environment variablesから次のParameter bundleだけを生成する。

1. `EnvironmentName=staging`
2. `VpcId`
3. `PrivateSubnetIds`
4. `PrivateHostedZoneId`
5. `RunnerDnsName`
6. `CertificateArn`
7. `RunnerServiceImageUri` = validated manifestのdigest URI
8. `RunnerInstanceType` = `t3.small|t3.medium`

account / region / ECR repository / ACM certificate / ID形式 / subnet一意性を検証する。

### review-only OIDC role / workflow

- dedicated Environment: `staging-python-runner-review`。
- exact OIDC subject。
- `ValidateTemplate`、target stack限定`CreateChangeSet`、Describe系、reviewed execution roleへの`PassRole`だけ。
- `ExecuteChangeSet` / direct CreateStack / UpdateStack / DeleteStackは禁止。
- workflowは`workflow_dispatch` + main + `CREATE_PYTHON_RUNNER_STAGING_CHANGE_SET`手入力。
- OIDC session 900秒、expected AWS accountを固定。
- change set summaryへAction / LogicalResource / ResourceType / Replacementを表示。
- `Execute: 未実施`、`Python Public gate: OFF`を明示する。

## Issue #145でまだ未完了の事項

- PR #154 review / merge。
- Python Runner staging用CloudFormation execution roleの最終least-privilege IaC。
- ECR release stack / review role / execution roleのActual bootstrapは別途review +明示承認が必要。
- GitHub Environmentsのrequired reviewer / main限定deployment protection / variables設定。
- 明示承認後のmanual image publish。
- 明示承認後のreview-only change set作成と差分確認。
- 明示承認後のchange set execute / Actual staging deploy。
- WorkerへのRunner Client SG / private URL / shared secret wiring。
- adversarial isolation test、concurrency / quota / cost、secret rotation / rollback確認。
- Python Public gate解除判断。

## Correctness・セキュリティ境界

- API processでsubmission codeを直接実行しない。
- WorkerへDocker socketを公開しない。
- Hidden testsをlearnerへ返さず、hidden caseをPython sandbox filesystemへmountしない。
- mutable image tagをstaging runtimeへ導入しない。
- arbitrary image URI / digestをstaging review workflowへ入力させない。
- release artifact checksum・publish run identity・main ancestryをAWS認証前に検証する。
- review roleへ`ExecuteChangeSet`やtarget resource直接変更権限を付与しない。
- long-lived AWS access keyをGitHub Actionsへ保存しない。
- Actual AWS変更・image push・change set実行は明示承認なしに実行しない。
- Submission + outbox atomicity、processing lease / attempt fencing / completion guardを弱めない。
- DB cutoverとqueue transport切替を同じchangeへ含めない。
- Production runtimeはSQLite / HTTPを維持する。

## 次の候補

Runner staging gate:

1. PR #154 merge。
2. CloudFormation execution roleのleast-privilege IaCをreview-only実装。
3. ECR / review / execution role stackとGitHub Environmentをレビューし、明示承認後にbootstrap。
4. manual image publish → release manifest生成。
5. review-only staging change set作成・レビュー。
6. 明示承認後のstaging deploy / adversarial test。
7. Python Public gate判定。

ユーザー価値:

1. Python Challenge追加。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページの実submissionデータ化。

基盤依存:

1. Submission read / simple write async移行。
2. Processing lease / attempt fencing async移行。
3. Submission + outbox atomic transaction async移行。
4. API / Worker DB provider切替。
5. Outbox claim / lease。
6. RDS / Secrets Manager / network IaC。
7. Data migration / staging rehearsal。

## 参照先

- Parent Issue #145: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- Issue #153: `https://github.com/mizzz-ivr/ai-code-dojo/issues/153`
- PR #154: `https://github.com/mizzz-ivr/ai-code-dojo/pull/154`
- Python Runner staging AWS設計: `docs/architecture/python-runner-staging-aws.md`
- Python Runner image release設計: `docs/architecture/python-runner-image-release.md`
- staging change set review設計: `docs/architecture/python-runner-staging-change-set-review.md`
- staging change set review runbook: `docs/runbooks/2026-08-19-python-runner-staging-change-set-review.md`
