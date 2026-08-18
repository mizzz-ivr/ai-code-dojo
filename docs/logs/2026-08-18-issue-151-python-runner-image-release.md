# Issue #151 Python Runner image release 実装ログ

日付: 2026-08-18

## 目的

PR #150で完成したPython Runner service imageを、private ECRへ安全にpublishできるreview-only release contractへ接続する。

## Issue管理

Linear Issue作成を試行したがFree workspace上限で失敗したため、GitHub Issue #151を正本として作成した。

## 実装

- `python-runner-image-release-stack.json`
  - ECR repository固定名。
  - IMMUTABLE。
  - scan-on-push。
  - AES256。
  - Retain。
  - untagged 7日lifecycle。
  - dedicated GitHub OIDC publisher role。
- `publish-python-runner-staging-image.yml`
  - manual only。
  - main only。
  - confirmation phrase手入力。
  - dedicated Environment。
  - OIDC 900秒。
  - repository drift検証。
  - pre-publish build / SBOM / Trivy gate。
  - source commit tag push。
  - registry digest readback。
  - release manifest / checksum artifact。
- IaC / workflow / manifest validator。
- ECR lifecycle semantic validator。
- manifest generator。
- unit test。
- `pnpm infra:validate`連携。

## 自己レビューで追加した強化

初回実装後に次を修正した。

1. 1択choice confirmationは明示確認として弱い。
   - 固定フレーズ手入力へ変更。
2. OIDC session durationが既定値依存。
   - 900秒へ固定。
3. lifecycle policyをraw文字列一致するとJSON整形差でfalse positiveになり得る。
   - JSON semantic validationへ変更。
4. publish後manifest artifact failureではimmutable tagを再pushできない。
   - runbookへread-only digest確認 + manifest再生成の例外復旧手順を明記。

## Security boundary

- Publisher roleはrepository push/readback以外を許可しない。
- repository delete / config mutationなし。
- static AWS keyなし。
- mutable tagなし。
- publish workflowからCloudFormationを操作しない。
- PR実装中のActual AWS apply / image pushなし。
- Python Public gate OFF。

## AWS scanning design

registry-level scanning configurationはaccount-wide影響を持つため本Issueでは変更しない。repository scan-on-pushとpublish前Trivy gateを使う。

## CI

初回code headではdocs-validation Success、app-qualityのlint / typecheck / unit / integration / schema / infra / buildがすべてSuccess。

自己レビュー修正・docs反映後の最終headで再確認する。
