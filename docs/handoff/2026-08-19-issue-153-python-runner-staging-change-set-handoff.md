# Issue #153 handoff — Python Runner staging change set review

日付: 2026-08-19

## 状態

- Issue: #153
- PR: #154
- Branch: `feat/python-runner-staging-change-set`
- Parent: #145
- Depends on: #151 / PR #152
- Actual AWS変更: 未実施
- Python Public submission: OFF / fail-closed

## 実装済み

- release workflow run IDからselected publish run identityを検証。
- exact run head SHAからimmutable release artifact名を導出。
- artifact file-set / checksum / schema / source commit / main ancestryをAWS認証前に検証。
- arbitrary image URI / digest入力を禁止。
- deterministic staging parameter bundleを生成。
- review-only GitHub OIDC role stackを追加。
- manual main-only change set review workflowを追加。
- CreateChangeSet / Describe / Pass reviewed execution roleだけを許可。
- ExecuteChangeSet / direct deployを禁止。
- unit test / infra validation / docsを同期。

## 初回CI修正

初回CIでworkflowのexact artifact実装とvalidatorの旧wildcard要件が不一致になり、unit / infra各1件が失敗した。

workflowを弱めず、validatorをexact artifact contractへ修正済み。

## 次の確認

1. PR #154最終CI。
2. review thread / comment / mergeability。
3. PR Ready for review化。
4. merge後の次タスクはPython Runner staging CloudFormation execution roleのleast-privilege IaCを推奨。

## Actual利用前の必須事項

- execution roleを別PRでレビュー。
- ECR / review / execution role stack bootstrapを明示承認後に実施。
- GitHub Environmentsへrequired reviewer / main限定branch protectionを設定。
- actual subnet private / multi-AZ、hosted zone association、ACM SAN/CN、egress topologyを確認。
- manual image publish後にreview-only change setを作成・レビュー。
- ExecuteChangeSetは別の明示承認後のみ。

## 維持する境界

- WorkerへDocker socketを公開しない。
- hidden testsをlearnerへ公開しない。
- Python Public gateはstaging adversarial test完了までOFF。
- DB / queue transport / Submission atomicity / lease / fencingは変更しない。
