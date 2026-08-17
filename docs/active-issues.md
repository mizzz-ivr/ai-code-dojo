# active-issues（正本）

最終更新: 2026-08-17（Issue #149 / PR #150 Python Runner service image）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #145 Python Runnerの本番隔離実行基盤を導入する

- 優先度: P1
- 状態: Open / Remote Runner + review-only staging IaCまでmerge済み / staging gate継続
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- PR #146: merge済み。
- PR #148: 2026-08-17 merge済み。
- Linear: 無料Issue上限のためGitHub Issue / Repository docs / Notionを管理正本とする。

#### 完了済み

- WorkerからPython Docker実行責務を分離した`apps/python-runner`。
- HMAC、idempotency、finite timeout / concurrency / queue。
- hidden test filesystem isolation。
- pinned Python sandbox image / network none / read-only / non-root / resource hardening。
- user-code failureのterminal grading分類。
- dedicated ECS/EC2 host、internal ALB、private DNS、Secrets Manager、専用SGのreview-only IaC。
- staging host / ECS service / app concurrencyの小さい上限。
- staging IaC security validator。

#### 残gate

- Issue #149 / PR #150 service image build・scan基盤。
- ECR publish / immutable digest release contract。
- AWS change set review。
- 明示承認後のActual staging deploy。
- Worker runtime wiring。
- adversarial isolation test。
- concurrency / quota / cost検証。
- secret rotation / rollback確認。
- Python Public gate解除判断。

### #149 Python Runner service imageの再現可能なbuild・scan基盤を追加する

- 優先度: P1
- 状態: Open / PR #150 Draft・実装/検証中
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/149`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/150`
- Branch: `feat/python-runner-service-image`
- Parent: #145
- Linear: Issue作成を試行したがFree workspace上限で失敗。GitHub Issueを正本とする。

#### 目的

PR #148のstaging IaCが要求するdigest固定可能なPython Remote Runner service imageを、Repository内で再現可能にbuild・検証する。

#### 実装済み

- Node.js 22.23.1 / Docker CLI 29.6.2をdigest固定したmulti-stage Dockerfile。
- runtimeからnpm / npx / yarnを除去。
- Python対応Challengeのtrusted runtime dataだけをpackaging。
- starter / legacy hidden `.py` / 他言語Challengeをservice imageへ含めない。
- path traversal / symlink拒否。
- read-only / cap-drop ALL / no-new-privilegesのservice container E2E。
- service image → host Docker → pinned Python sandbox → reference submission 100点の実Docker contract。
- CycloneDX SBOM。
- Trivy JSON report artifact。
- HIGH / CRITICALを原則fail-closed拒否。

#### 脆弱性例外

初回Trivy scanではDocker CLI binary内Go stdlib `1.26.5`由来のHIGH 8件、CRITICAL 0件を検出した。

利用可能なstable upstreamへ更新してもまだ解消できないため、承認済み8 CVEだけを次の条件で期限付き許可する。

- path: `usr/local/bin/docker`
- PURL: `pkg:golang/stdlib@v1.26.5`
- expiry: `2026-09-17`

unknown CVE追加、PURL wildcard化、期限延長は専用validator / unit testで拒否する。

#### このIssueでは行わない

- ECR repository作成。
- AWS credential / OIDC push permission追加。
- image push。
- staging deploy。
- Python Public allowlist変更。
- DB / queue transport切替。

## Blocked Issue

### Python Challengeの公開提出可能化

- 状態: Blocked / Issue #145 staging gate required。
- Python contentはcatalogへ存在しても「採点準備中」とする。
- Web / API / Workerの公開allowlistへPythonを追加しない。
- 再開条件:
  1. PR #150をmergeする。
  2. ECR publish / digest release contractを完成させる。
  3. review-only AWS change setをレビューする。
  4. 明示承認後にstaging Remote Runnerをdeployする。
  5. Runner Client SG / URL / secretをWorkerへ安全にwiringする。
  6. hidden filesystem / network / privilege / resource / timeout / orphan cleanupをstagingで再検証する。
  7. concurrency / quota / cost上限を確認する。
  8. adversarial code testを通す。

### ECS API / Worker production wiring

- 状態: Blocked / DB移行依存あり。
- Admin Challenge async Repositoryまでは完了済み。
- Submission / lease / outbox Repository async移行、outbox claim / lease、RDS / secret / network IaC、data migration rehearsalが残る。

## Recently Completed

### #147 / PR #148（完了済み）

- 完了日: 2026-08-17（日本時間）。
- Python Remote Runnerのdedicated ECS/EC2 staging review-only IaC、network / IAM / secret / cost boundary、Repository validatorをmainへ反映。
- Actual AWS resourceは未作成。

### #145 部分完了 / PR #146（merge済み）

- 完了日: 2026-08-14（日本時間）。
- Python Remote Runner境界、hidden test filesystem isolation、HMAC、idempotency、resource hardening、terminal failure分類をmainへ反映。
- Parent Issue #145はstaging gate完了までOpenを維持する。

### #143 / PR #144（完了済み）

- SQL / HTML-CSS固定Runner、Python isolated-preview、Runner contract共通化、Public Challenge 9件化をmainへ反映。

### #141 / PR #142（完了済み）

- 公開Challenge検索・絞り込み、JS/TS実践問題、TypeScript実採点、Submission target validationをmainへ反映。

### #139 / PR #140（完了済み）

- Admin Challenge Repositoryをasync DatabaseClientへ移行。

### #137 / PR #138（完了済み）

- PostgreSQL 18.4 / `pg` / migration executor / 実DB contractを導入。

## Follow-up候補

Runner安全性:

1. #149 / PR #150 merge。
2. ECR repository + image publish / immutable digest release contractをreview-onlyで実装。
3. 明示承認後のstaging adversarial test。
4. Docker socketを廃止するjob-per-task executor backendの検討。

ユーザー価値:

1. Python Challenge追加。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページの実データ化。

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
- Docker socket root-equivalent権限をdedicated Runner host / control-plane外へ拡散しない。
- API processでsubmission codeを直接実行しない。
- service image内のhidden casesをPython sandbox filesystemへmountしない。
- Hidden testsをlearner向け公開境界へ返さない。
- 脆弱性例外を無期限・wildcardで許可しない。
- Submission + outbox atomicityを弱めない。
- Processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
