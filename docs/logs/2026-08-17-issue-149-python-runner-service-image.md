# Issue #149 Python Runner service image 実装ログ

日付: 2026-08-17

## 依頼

PR #148 merge後の次タスクとして、staging IaCへ渡せるPython Remote Runner service imageのbuild・scan基盤を実装する。

## Issue管理

LinearへIssue作成を試行したがFree workspace上限で失敗したため、GitHub Issue #149を正本として作成した。

- Issue: #149
- Branch: `feat/python-runner-service-image`
- PR: #150

## 実装

- Node.js 22.23.1 / Docker CLI 29.6.2 digest固定Dockerfile。
- runtimeからnpm / npx / yarnを除去。
- Python Challenge runtime packager。
- problem / visible JSON / hidden JSONだけをservice imageへ配置。
- starter / legacy hidden `.py` / 他言語Challengeを除外。
- path traversal / symlink fail-closed test。
- containerized Runner → host Docker → pinned Python sandbox E2E。
- CycloneDX SBOM。
- Trivy raw JSON artifact。

## 自己レビューで追加した改善

初回Trivy scanではCIのCRITICAL gateは成功したが、raw artifactを確認するとHIGH 8件が存在した。

8件はすべて`/usr/local/bin/docker`の`pkg:golang/stdlib@v1.26.5`由来で、CRITICALは0件だった。

単にHIGHをreport-onlyにせず、次へ変更した。

1. HIGH / CRITICALを原則failureへ引き上げ。
2. 現在stable upstreamで解消できない8 CVEだけを期限付き例外化。
3. pathを`usr/local/bin/docker`へ限定。
4. PURLを`pkg:golang/stdlib@v1.26.5`へ限定。
5. expiryを`2026-09-17`へ固定。
6. unknown CVE追加、PURL wildcard、期限延長を拒否するvalidator / unit testを追加。
7. raw Trivy reportは例外適用前の情報をartifactとして保持。

## CI確認

コードhead `e0c184930078cc4a1f6e68f10e7febd16866f43c`で以下を確認済み。

### python-runner-image-quality

- packager unit test: success
- service image build: success
- runtime content contract: success
- pinned sandbox image pull: success
- hardened service container start: success
- containerized Runner → host Docker → Python sandbox E2E: success
- SBOM: success
- Trivy JSON: success
- artifact upload: success
- HIGH / CRITICAL gate with scoped exceptions: success
- cleanup: success

### app-quality

- lint: success
- typecheck: success
- unit-test: success
- integration-test: success
- schema-validation: success
- infra-validation: success
- build: success

その後、Trivy例外validatorを追加し、最終headで専用workflow / app-qualityを再実行する。

## 維持した境界

- AWS resource変更なし。
- ECR pushなし。
- GitHub ActionsへAWS credential追加なし。
- Python Public gate変更なし。
- WorkerへDocker socketを公開しない。
- submitted Python codeはnon-root sandbox。
- hidden casesをsandbox filesystemへmountしない。
- DB / queue transport / Submission atomicity / lease / fencingは変更しない。

## 次タスク

PR #150 merge後は、ECR repositoryとimage publish / immutable digest release contractをreview-onlyで実装する。
