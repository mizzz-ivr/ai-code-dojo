# active-issues（正本）

最終更新: 2026-08-19（Issue #153 / PR #154 Python Runner staging change set review）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #145 Python Runnerの本番隔離実行基盤を導入する

- 優先度: P1
- 状態: Open / Remote Runner・review-only staging IaC・service image・ECR release contractまでmerge済み / staging gate継続
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- PR #146 / #148 / #150 / #152: merge済み。
- Python Public submission: OFF / fail-closed。

#### 完了済み

- WorkerからPython Docker実行責務を分離したRemote Runner。
- HMAC / idempotency / finite timeout / concurrency / queue。
- hidden test filesystem isolation。
- pinned Python sandbox / network none / read-only / non-root / resource hardening。
- dedicated ECS/EC2 host、internal ALB、private DNS、Secrets Manager、専用SGのreview-only IaC。
- digest固定Runner service image、nested Docker E2E、SBOM、Trivy gate。
- private ECR immutable release contract、OIDC publisher、source commit → digest release manifest。

#### 残gate

- Issue #153 / PR #154 release manifest → review-only staging change set。
- Python Runner staging CloudFormation execution roleのleast-privilege IaC。
- ECR / review / execution role stacksのbootstrap review / 明示承認。
- dedicated GitHub Environments保護設定。
- 明示承認後のmanual image publish。
- review-only change set作成・レビュー。
- 明示承認後のActual staging deploy。
- Worker runtime wiring。
- adversarial isolation test、concurrency / quota / cost検証、secret rotation / rollback確認。
- Python Public gate解除判断。

### #153 Python Runner staging change setをrelease manifestからreview-only生成する

- 優先度: P1
- 状態: Open / PR #154 Ready for review / CI green / mergeable
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/153`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/154`
- Branch: `feat/python-runner-staging-change-set`
- Parent: #145
- Depends on: #151 / PR #152
- Linear: Issue作成を試行したがFree workspace上限で失敗。GitHub Issueを正本とする。

#### 目的

PR #152のvalidated immutable release manifestだけをPython Runner staging stack parameterへ接続し、任意image URIを入力できないreview-only change set経路を作る。

#### 実装済み

- manual workflow入力はrelease workflow run IDと固定確認フレーズだけ。
- publish runがmanual / main / SuccessであることをAWS credential取得前に確認。
- publish run `head_sha`からexact artifact名を算出し、そのrun内の未期限artifactを1件だけ許可。
- artifact file集合、SHA-256 checksum、release manifest schemaをfail-closed検証。
- manifest source commitとpublish run head SHAを一致させ、current main ancestorだけ許可。
- validated manifestから`RunnerServiceImageUri=repository@sha256:digest`を生成。
- VPC / subnet / hosted zone / DNS / ACM certificate / instance typeをGitHub Environment variablesから取得して形式・account・regionを検証。
- deterministic CloudFormation parameter bundleを生成。
- dedicated OIDC review roleはValidateTemplate / CreateChangeSet / Describe系 / reviewed execution role PassRoleだけ。
- workflowは`ExecuteChangeSet` / direct deploy / create-stack / update-stack / delete-stackを禁止。
- change set summaryへReplacementを含む差分を表示。
- Repository validator / unit testを`pnpm infra:validate` / `pnpm test:unit`へ統合。
- 初回CIで残っていたartifact wildcard validatorを、workflow本体のexact artifact identity contractへ修正。
- 最終headでdocs / lint / typecheck / unit / integration / schema / infra / buildをすべてSuccess確認。

#### このIssueでは行わない

- ECR release stack Actual apply。
- Actual image publish。
- CloudFormation execution roleの最終IaC。
- review role Actual apply。
- Actual change set作成・実行。
- staging deploy / Worker wiring / Python Public allowlist変更。

#### 要確認・後続

- `PrivateSubnetIds`はこのPRでは形式・2件以上・一意性まで検証する。実AWS上でprivate subnetか、2 AZ以上かはActual実行前に別途read-only preflightまたは手動確認が必要。
- ACM certificateのSAN/CNがRunnerDnsNameをcoverすること、private hosted zoneが対象VPCへassociation済みであることもActual実行前確認が必要。
- change set実行前に、staging stackが必要とするCloudFormation execution roleを別PRでleast privilege定義する。

## Blocked Issue

### Python Challengeの公開提出可能化

- 状態: Blocked / Issue #145 staging gate required。
- Python contentはcatalogへ存在しても「採点準備中」とする。
- 公開allowlistへPythonを追加しない。
- 再開条件:
  1. PR #154をmergeする。
  2. execution roleとActual bootstrap手順をレビューする。
  3. 明示承認後にECR imageをpublishする。
  4. review-only staging change setを作成・レビューする。
  5. 明示承認後にstaging Remote Runnerをdeployする。
  6. Worker Client SG / URL / secretを安全にwiringする。
  7. hidden filesystem / network / privilege / resource / timeout / orphan cleanupをstagingで再検証する。
  8. concurrency / quota / cost上限を確認し、adversarial code testを通す。

### ECS API / Worker production wiring

- 状態: Blocked / DB移行依存あり。
- Submission / lease / outbox Repository async移行、outbox claim / lease、RDS / secret / network IaC、data migration rehearsalが残る。

## Recently Completed

### #151 / PR #152（完了済み）

- 完了日: 2026-08-19（日本時間）。
- ECR immutable release contract、manual OIDC publish workflow、registry digest release manifest、validator / runbookをmainへ反映。
- merge commit: `31432fde4695e17582dcea997a0a6bef772fee45`。
- Actual AWS / ECR変更・image pushは未実施。

### #149 / PR #150（完了済み）

- 完了日: 2026-08-18（日本時間）。
- Python Runner service image、trusted runtime packaging、nested Docker E2E、SBOM、Trivy gateをmainへ反映。
- merge commit: `eb13f0b204ef6d34ce0c47327e7f76289c274988`。

### #147 / PR #148（完了済み）

- dedicated ECS/EC2 staging review-only IaC、network / IAM / secret / cost boundary、validatorをmainへ反映。

## Follow-up候補

Runner staging gate:

1. #153 / PR #154 merge。
2. Python Runner staging CloudFormation execution role least-privilege IaC。
3. 明示承認後のECR / review / execution role bootstrapとGitHub Environment設定。
4. manual image publish → review-only change set → explicit-approved deploy。
5. staging adversarial / cost / rollback検証。
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
7. Data migration / staging cutover rehearsal。

## Scale / safety gate

- PythonをActual staging検証前に公開しない。
- WorkerへDocker socketを公開しない。
- hidden casesをPython sandbox filesystemへmountしない。
- mutable ECR tagや任意image URIをstaging runtimeへ渡さない。
- release artifact identity / checksum / main ancestryをAWS認証前に検証する。
- review roleへ`ExecuteChangeSet`やtarget resource直接変更権限を与えない。
- AWS long-lived access keyをGitHub Actionsへ保存しない。
- Submission + outbox atomicity、processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Actual AWS resource / image push / change set executionはreviewと明示承認を経る。
