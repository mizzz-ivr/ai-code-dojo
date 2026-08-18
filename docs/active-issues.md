# active-issues（正本）

最終更新: 2026-08-18（Issue #151 / PR #152 Python Runner ECR release contract）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #145 Python Runnerの本番隔離実行基盤を導入する

- 優先度: P1
- 状態: Open / Remote Runner・review-only staging IaC・service imageまでmerge済み / staging gate継続
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- PR #146 / #148 / #150: merge済み。
- Linear: 無料Issue上限のためGitHub Issue / Repository docs / Notionを管理正本とする。

#### 完了済み

- WorkerからPython Docker実行責務を分離したRemote Runner。
- HMAC / idempotency / finite timeout / concurrency / queue。
- hidden test filesystem isolation。
- pinned Python sandbox / network none / read-only / non-root / resource hardening。
- dedicated ECS/EC2 host、internal ALB、private DNS、Secrets Manager、専用SGのreview-only IaC。
- digest固定Node / Docker CLI service image。
- nested Docker E2E、SBOM、HIGH/CRITICAL Trivy gate。

#### 残gate

- Issue #151 / PR #152 ECR publish / immutable digest release contract。
- ECR release stack bootstrapのreview /明示承認。
- dedicated GitHub Environment保護設定。
- 明示承認後のmanual image publish。
- digest URIを使用したstaging change set review。
- 明示承認後のActual staging deploy。
- Worker runtime wiring。
- adversarial isolation test。
- concurrency / quota / cost検証。
- secret rotation / rollback確認。
- Python Public gate解除判断。

### #151 Python Runner ECR publishとimmutable digest release contractをreview-onlyで追加する

- 優先度: P1
- 状態: Open / PR #152 Draft・実装/検証中
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/151`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/152`
- Branch: `feat/python-runner-ecr-release`
- Parent: #145
- Depends on: #149 / PR #150
- Linear: Issue作成を試行したがFree workspace上限で失敗。GitHub Issueを正本とする。

#### 目的

PR #150のservice imageをprivate ECRへ安全にpublishできる契約と、staging IaCへ渡す`repository@sha256:digest` release manifestを定義する。

#### 実装中

- ECR repository / GitHub OIDC publisher roleのreview-only CloudFormation。
- repository名固定、tag完全IMMUTABLE、scan-on-push、AES256、Retain。
- lifecycleはuntagged imageを7日後に削除するだけ。
- publisher roleは対象repositoryのpush/readbackだけ。設定変更・削除権限なし。
- manual `workflow_dispatch` publish workflow。
- main限定、固定フレーズ手入力、dedicated Environment、15分OIDC session。
- account / region / repository URI / IAM role ARN drift拒否。
- source tag `sha-<full source commit>`固定、existing tag拒否。
- publish前build / runtime content / SBOM / raw Trivy / HIGH-CRITICAL gate。
- ECR lifecycle JSON semantic validation。
- registry digest readbackとrelease manifest + checksum artifact。
- IaC/workflow/manifest contract validatorとunit test。

#### このIssueでは行わない

- Actual CloudFormation apply。
- Actual ECR repository作成。
- GitHub Environment作成・設定変更。
- Actual image push。
- staging deploy。
- Worker wiring。
- Python Public allowlist変更。

## Blocked Issue

### Python Challengeの公開提出可能化

- 状態: Blocked / Issue #145 staging gate required。
- Python contentはcatalogへ存在しても「採点準備中」とする。
- 公開allowlistへPythonを追加しない。
- 再開条件:
  1. PR #152をmergeする。
  2. ECR release stackとGitHub Environmentをreviewし、明示承認後にbootstrapする。
  3. manual publishでdigest-pinned release manifestを生成する。
  4. Python Runner staging change setをレビューする。
  5. 明示承認後にstaging Remote Runnerをdeployする。
  6. Runner Client SG / URL / secretをWorkerへ安全にwiringする。
  7. hidden filesystem / network / privilege / resource / timeout / orphan cleanupをstagingで再検証する。
  8. concurrency / quota / cost上限を確認する。
  9. adversarial code testを通す。

### ECS API / Worker production wiring

- 状態: Blocked / DB移行依存あり。
- Submission / lease / outbox Repository async移行、outbox claim / lease、RDS / secret / network IaC、data migration rehearsalが残る。

## Recently Completed

### #149 / PR #150（完了済み）

- 完了日: 2026-08-18（日本時間）。
- Python Runner service image、trusted runtime packaging、nested Docker E2E、SBOM、Trivy HIGH/CRITICAL gateをmainへ反映。
- merge commit: `eb13f0b204ef6d34ce0c47327e7f76289c274988`。
- Actual ECR / AWS変更は未実施。

### #147 / PR #148（完了済み）

- 完了日: 2026-08-17（日本時間）。
- dedicated ECS/EC2 staging review-only IaC、network / IAM / secret / cost boundary、validatorをmainへ反映。
- Actual AWS resourceは未作成。

### #145 部分完了 / PR #146（merge済み）

- Python Remote Runner、hidden test filesystem isolation、HMAC、idempotency、resource hardeningをmainへ反映。
- Parent #145はstaging gate完了までOpenを維持する。

## Follow-up候補

Runner安全性:

1. #151 / PR #152 merge。
2. 明示承認後のECR release bootstrap / manual publish。
3. staging change set / adversarial test。
4. Docker socketを廃止するjob-per-task executor backendの検討。

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
- mutable ECR tagをstaging runtimeへ渡さない。
- image publisher roleへrepository削除・設定変更権限を与えない。
- AWS long-lived access keyをGitHub Actionsへ保存しない。
- 脆弱性例外を無期限・wildcardで許可しない。
- Submission + outbox atomicity、processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Actual AWS resource / image pushはreviewと明示承認を経る。
