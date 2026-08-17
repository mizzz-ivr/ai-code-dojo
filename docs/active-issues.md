# active-issues（正本）

最終更新: 2026-08-14（Issue #147 Python Runner staging review-only IaC）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #145 Python Runnerの本番隔離実行基盤を導入する

- 優先度: P1
- 状態: Open / PR #146 merge済み / staging gate継続
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- PR #146: 2026-08-14 merge済み
- Linear: 無料Issue上限のためGitHub Issue / Repository docs / Notionを管理正本とする。

#### 完了済み

PR #146で次をmainへ反映済み。

- `apps/python-runner`専用Remote Runner service。
- WorkerはHMAC署名付きHTTP clientのみ。
- WorkerからPython Docker実行責務を削除。
- hidden test filesystem isolation。
- fixed Python sandbox image / resource hardening。
- idempotency / concurrency / queue / orphan cleanup。
- user-code failureをterminal gradingへ分類し、infra retry cost amplificationを防止。

#### 残gate

- Issue #147 review-only staging IaC。
- AWS change set review。
- 明示承認後のActual staging deploy。
- Worker runtime wiring。
- adversarial isolation test。
- concurrency / quota / cost検証。
- secret rotation / rollback確認。
- Python Public gate解除判断。

### #147 Python Remote Runnerのreview-only AWS/staging IaCを追加する

- 優先度: P1
- 状態: Open / 実装中
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/147`
- Branch: `feat/python-runner-staging-iac`
- Parent: #145
- Linear: Issue作成を試行したがFree workspace上限で失敗。GitHub Issueを正本とする。

#### 目的

現行Python Remote RunnerをActual AWSへまだ適用せず、stagingでレビュー・隔離検証できるCloudFormationとして定義する。

#### 実装方針

- 現行Runnerはhost Docker daemon / `sourcePath` bind mount依存のためFargateを採用しない。
- 専用ECS/EC2 hostを1台固定する。
- WorkerへDocker socketを渡さない。
- Runner control planeのDocker socketアクセスはdedicated host内の明示例外とする。
- internal ALB + HTTPS 443。
- Runner Client専用SGを作り、Actual Worker wiring時に明示attachする。
- ALB → hostはprivate VPC内HTTP 8090のみ。
- host public IP / SSHなし。
- HMAC secretはSecrets Manager自動生成。
- Runner application TaskRoleなし。
- ASG / ECS service / app concurrencyをstaging上限へ固定する。
- Repository validatorで危険な差分をfail-closed拒否する。

#### 完了条件

- review-only CloudFormation追加。
- validator / unit test追加。
- `pnpm infra:validate`へ統合。
- architecture / runbook / handoff更新。
- CI全成功。
- PR Ready for review。
- Actual AWS resourceは作成しない。
- Python Public gateを変更しない。

## Blocked Issue

### Python Challengeの公開提出可能化

- 状態: Blocked / Issue #145 staging gate required。
- Python contentはcatalogへ存在しても「採点準備中」とする。
- Web / API / Workerの公開allowlistへPythonを追加しない。
- 再開条件:
  1. Issue #147をmergeする。
  2. review-only change setをレビューする。
  3. 明示承認後にstaging Remote Runnerをdeployする。
  4. Runner Client SG / URL / secretをWorkerへ安全にwiringする。
  5. hidden filesystem / network / privilege / resource / timeout / orphan cleanupをstagingで再検証する。
  6. concurrency / quota / cost上限を確認する。
  7. adversarial code testを通す。

### ECS API / Worker production wiring

- 状態: Blocked / DB移行依存あり。
- Admin Challenge async Repositoryまでは完了済み。
- Submission / lease / outbox Repository async移行、outbox claim / lease、RDS / secret / network IaC、data migration rehearsalが残る。

## Recently Completed

### #145 部分完了 / PR #146（merge済み）

- 完了日: 2026-08-14（日本時間）。
- Python Remote Runner境界、hidden test filesystem isolation、HMAC、idempotency、resource hardening、terminal failure分類をmainへ反映。
- Parent Issue #145はstaging gate完了までOpenを維持する。

### #143 / PR #144（完了済み）

- 完了日: 2026-08-13（日本時間）。
- SQL / HTML-CSS固定Runner、Python isolated-preview、Runner contract共通化、Public Challenge 9件化をmainへ反映。

### #141 / PR #142（完了済み）

- 公開Challenge検索・絞り込み、JS/TS実践問題4件、TypeScript実採点、Submission target validationをmainへ反映。

### #139 / PR #140（完了済み）

- Admin Challenge Repositoryをasync DatabaseClientへ移行。

### #137 / PR #138（完了済み）

- PostgreSQL 18.4 / `pg` / migration executor / 実DB contractを導入。

## Follow-up候補

ユーザー価値:

1. Python Challenge追加。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページの実データ化。

Runner安全性:

1. #147 review-only staging IaC。
2. 明示承認後のstaging adversarial test。
3. Docker socketを廃止するjob-per-task executor backendの検討。

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
- Docker socket root-equivalent権限をdedicated Runner host外へ拡散しない。
- API processでsubmission codeを直接実行しない。
- Problem JSON由来commandを任意shellとして実行しない。
- Hidden testsをlearner向け公開境界へ返さない。
- ユーザーコード起因failureをinfra retryへ誤分類しない。
- Submission + outbox atomicityを弱めない。
- Processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
