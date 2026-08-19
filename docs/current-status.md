# current-status（正本）

最終更新: 2026-08-18（Issue #151 / PR #152 Python Runner ECR release contract）

## この文書の目的

「今どこまで実装済みか」を短時間で把握するための現況スナップショット。

## 今の状態

- Repository: `mizzz-ivr/ai-code-dojo`。
- AI生成コードのバグ修正・機能追加を実務フローで学ぶ練習プラットフォームとしてMVP開発中。
- PR #142 / #144 / #146 / #148 / #150はmerge済み。
- PR #150は2026-08-18にmerge済み。Python Runner service imageの再現可能build、実Docker E2E、SBOM、Trivy gateをmainへ反映済み。
- Issue #149はPR #150 mergeでCompleted。
- Issue #151 / PR #152でprivate ECR repository、GitHub OIDC publisher、immutable source-commit tag、registry digest release manifestのreview-only contractを実装中。
- Parent Issue #145はOpenのまま。Actual AWS apply / image publish / staging deploy / adversarial test / Python公開判定が残る。
- PythonはPublic APIで引き続きfail-closed拒否する。
- Linearは無料Issue上限のためIssue #151はGitHub Issue / Repository docs / Notionを管理正本とする。

## 現行runtime

- Production相当Database provider: SQLite `.data/app.db`。
- Queue transport既定: HTTP。
- Public Challenge Repository: file-backed。
- Admin Challenge Repository: DB-backed / async DatabaseClient。
- Submission / lease / outbox Repository: 同期SQLite固有APIを継続。
- PostgreSQL 18.4 migration / integration基盤は利用可能だが、本番DB切替は未実施。
- RDS / ECS / ECR / Secrets ManagerのActual AWS resourceは今回のreview-only作業では作成・変更していない。

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
- HMAC、idempotency、finite timeout / concurrency / queue。
- hidden test filesystem isolation。
- submitted codeはnetworkなし・read-only・non-root sandbox。
- user-code failureとinfra failureを分離。

### PR #148 staging review-only IaC

- dedicated ECS/EC2 Runner host。
- internal ALB / private DNS / Secrets Manager /専用SG。
- Docker socket / shared workspaceはdedicated host境界だけ。
- Actual AWS resourceは未作成。

### PR #150 service image build・scan

- Node.js 22.23.1 / Docker CLI 29.6.2をdigest固定。
- runtimeからnpm / npx / yarnを除去。
- Python採点に必要なtrusted runtime dataだけをservice imageへpackage。
- starter / legacy hidden `.py` /他言語Challenge / docs / git metadataを除外。
- containerized Runner → host Docker → pinned Python sandbox → reference submission 100点E2E。
- CycloneDX SBOM / raw Trivy JSON。
- HIGH / CRITICALを原則fail-closed。
- Docker CLI Go stdlib由来HIGH 8件だけをpath/PURL/CVE/expiry=`2026-09-17`固定で期限付き許可。

merge commit: `eb13f0b204ef6d34ce0c47327e7f76289c274988`

## Issue #151 / PR #152 Python Runner ECR release contract

### review-only IaC

- ECR repository名: `ai-code-dojo-staging-python-runner`固定。
- `ImageTagMutability=IMMUTABLE`、除外なし。
- scan-on-push有効。
- AES256 encryption明示。
- `DeletionPolicy` / `UpdateReplacePolicy` = `Retain`。
- `EmptyOnDelete=false`。
- lifecycleはuntagged imageを7日後に削除するだけ。tagged releaseは自動削除しない。
- dedicated GitHub Environment `staging-python-runner-image`向けOIDC publisher role。
- publisher roleは対象repositoryへのlayer upload / PutImage / readbackだけ。repository設定変更・削除・IAM / CloudFormation権限なし。

### manual publish contract

Actual publish workflowはコードとして定義するが、このIssue実装中には実行しない。

実行条件:

- `workflow_dispatch`のみ。
- `main`のみ。
- `PUBLISH_STAGING_PYTHON_RUNNER_IMAGE`の手入力確認必須。
- GitHub Environment `staging-python-runner-image`。
- `contents: read` / `id-token: write`のみ。
- static AWS access key不使用。
- OIDC sessionは900秒。
- expected AWS account / ECR URI / publisher roleをfail-closed検証。

publish前:

- actual repositoryがIMMUTABLE / scan-on-push / AES256か検証。
- lifecycle policyをJSON意味比較で検証。
- `sha-<full source commit>` tagが未使用であることを検証。
- service imageを再build。
- runtime content contract、SBOM、raw Trivy、HIGH/CRITICAL gateを再実行。

publish後:

- ECRからregistry digestをreadback。
- source commit / immutable tag / repository URI / registry digest / `repository@sha256:digest`を結ぶrelease manifestを生成。
- manifest本体とSHA-256 checksumをartifact保存。
- staging deployは自動実行しない。

## Issue #145でまだ未完了の事項

- PR #152 review / merge。
- ECR release stackのActual AWS applyは別途review + 明示承認が必要。
- dedicated GitHub Environment作成とrequired reviewer / branch protection / variables設定。
- 明示承認後のmanual image publish。
- release manifestのdigest URIを使用したPython Runner staging change set review。
- 明示承認後のActual staging deploy。
- WorkerへのRunner Client SG / private URL / shared secret wiring。
- adversarial isolation test。
- concurrency / quota / cost確認。
- secret rotation / rollback確認。
- Python Public gate解除判断。

## Correctness・セキュリティ境界

- API processでsubmission codeを直接実行しない。
- WorkerへDocker socketを公開しない。
- Docker socket root-equivalent権限は専用Runner host / control-planeだけに限定する。
- Hidden testsをlearnerへ返さず、hidden case JSONをPython sandbox filesystemへmountしない。
- mutable image tagをstaging runtime contractへ導入しない。
- ECR publisher roleへrepository設定変更・削除権限を付与しない。
- long-lived AWS access keyをGitHub Actionsへ保存しない。
- Actual AWS変更・image pushは明示承認なしに実行しない。
- Submission + outbox atomicity、processing lease / attempt fencing / completion guardを弱めない。
- DB cutoverとqueue transport切替を同じchangeへ含めない。
- Production runtimeはSQLite / HTTPを維持する。

## 次の候補

Runner staging gate:

1. PR #152 merge。
2. ECR release stack / GitHub Environmentをレビューし、明示承認後にbootstrap。
3. manual publishでdigest-pinned release manifest生成。
4. Python Runner staging change set review。
5. 明示承認後のstaging deploy / adversarial test。
6. Python Public gate判定。

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
- Issue #151: `https://github.com/mizzz-ivr/ai-code-dojo/issues/151`
- PR #152: `https://github.com/mizzz-ivr/ai-code-dojo/pull/152`
- Python Runner service image設計: `docs/architecture/python-runner-service-image.md`
- Python Runner image release設計: `docs/architecture/python-runner-image-release.md`
- Python Runner image release runbook: `docs/runbooks/2026-08-18-python-runner-image-release.md`
