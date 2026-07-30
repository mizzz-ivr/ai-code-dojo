# Issue #127 GitHub OIDC staging change set 実装ログ

日付: 2026-07-30

## 依頼

PR #126の続きとして、正本の最優先候補である限定環境のdeployment wiringを進める。

## 判断

実AWS deployやproduction切替を自動化せず、stagingのreview-only change set作成までを今回の境界とした。

理由:

- PR #126はqueue / DLQ / workload roleのresource再現性までを提供した。
- 次に必要なのは長期access keyを使わないAWS認証と安全な差分レビュー入口である。
- ExecuteChangeSetまで同じworkflowへ持たせると、レビューと実行の責務が混ざる。
- ECS runtime resourceが未実装のため、task role関連付けを推測で追加すべきではない。

## 実装

- GitHub Issue #127を作成した。
- Linear登録を試行したがworkspaceの無料Issue上限で失敗したため、GitHub / Repository docs / Notionを正本とした。
- NotionにIssue #127ページを作成した。
- staging OIDC deployment / CloudFormation execution role templateを追加した。
- `workflow_dispatch`専用のreview-only change set workflowを追加した。
- OIDC trust、PassRole、CloudFormation action、workflow trigger / credential境界をstatic validationする。
- Security regression unit testを7件追加した。
- `pnpm infra:validate`へOIDC deployment validationを統合した。

## セキュリティ判断

- OIDC provider ARNとsubjectに既定値を持たせない。
- GitHub subjectはimmutable形式の可能性があるため、repository名から固定値を埋め込まない。
- Subjectはstaging Environmentとの完全一致としwildcardを拒否する。
- Deployment roleとCloudFormation execution roleを分離する。
- Deployment roleはCreateChangeSet / read / PassRoleだけとする。
- WorkflowへExecuteChangeSetを入れない。
- GitHub Environmentのmain branch protectionを必須運用とする。
- Account IDをworkflow出力でmaskする。

## ローカル確認

- OIDC deployment validator unit test: 7 / 7 success
- JSON parse: success
- Workflow security contract: success

## 未確認

- 実AWS `validate-template`
- Bootstrap change set
- OIDC token発行 / AssumeRoleWithWebIdentity
- Organization SCP / permission boundary
- CloudFormation execution roleの実resource操作
- SQS stack change set作成
