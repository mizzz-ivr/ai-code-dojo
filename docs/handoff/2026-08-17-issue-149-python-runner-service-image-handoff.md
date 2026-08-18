# Issue #149 Python Runner service image handoff

最終更新: 2026-08-17

## 現在地

- Parent Issue: #145
- Issue: #149 `Python Runner service imageの再現可能なbuild・scan基盤を追加する`
- PR: #150 `Python Runner service imageの再現可能なbuild・scan基盤を追加`
- Branch: `feat/python-runner-service-image`
- Actual AWS / ECR: 未変更
- Python Public submission: OFF / fail-closed

## 実装済み

### Service image

- `apps/python-runner/Dockerfile`
- Node.js 22.23.1 / Alpine 3.24 digest固定。
- Docker CLI 29.6.2 / Alpine 3.24 digest固定。
- Docker CLI binaryだけをruntimeへcopy。
- npm / npx / yarnをruntimeから除去。
- staging IaCと同じshared workspace path。

### Runtime packaging

- `scripts/package-python-runner-problems.mjs`
- Python対応Challengeのみ。
- `problem.json`、visible JSON、hidden JSONのみ。
- starter、legacy hidden `.py`、他言語Challengeを除外。
- traversal / symlink拒否。

### CI

- `.github/workflows/python-runner-image-quality.yml`
- local buildのみ。registry pushなし。
- runtime content contract。
- hardened service container起動。
- service container → host Docker → pinned Python sandbox → score 100 E2E。
- CycloneDX SBOM。
- Trivy raw report。
- HIGH / CRITICAL gate。

### Vulnerability exception

初回raw scan:

- CRITICAL: 0
- HIGH: 8
- すべてDocker CLI `/usr/local/bin/docker`
- PURL: `pkg:golang/stdlib@v1.26.5`

stable upstreamで現時点の解消版が利用できないため、承認済み8件だけを`2026-09-17`まで一時許可する。

`tests/unit/python-runner-trivy-exception-validator.test.mjs`で、unknown CVE追加、PURL拡張、期限延長を拒否する。

## レビュー時の重要ポイント

1. Docker socket root-equivalent権限がservice control-plane外へ漏れていないこと。
2. submitted codeがnon-root sandboxのままであること。
3. hidden case JSONはservice imageのtrusted filesystemにだけあり、sandboxへmountされないこと。
4. starter / legacy hidden `.py`がimageへ入っていないこと。
5. base imageとDocker CLIがdigest固定されていること。
6. Trivy例外が8件・path/PURL/expiry固定であること。
7. PR CIにAWS write permissionがないこと。

## Merge前に確認すること

- docs-validation success。
- app-quality全job success。
- python-runner-image-quality success。
- review thread 0または全resolve。
- PR mergeable。
- PR bodyへ最終head / scan結果 / exception rationaleを同期。

## Merge後の次タスク

`ECR repository + Python Runner image publish / immutable digest release contract`をreview-onlyで実装する。

推奨scope:

- ECR repository CloudFormation。
- tag immutability。
- encryption / lifecycle / scan policy。
- GitHub OIDC least-privilege push role。
- main/release限定publish。
- push後のregistry digest取得。
- `RunnerServiceImageUri=<ECR>@sha256:<digest>`をrelease outputとして扱う。
- SBOM / vulnerability resultをrelease metadataへ関連付ける。

非対象:

- CloudFormation execute。
- staging deploy。
- Python Public gate ON。

Actual AWS変更は引き続き明示承認後だけ行う。
