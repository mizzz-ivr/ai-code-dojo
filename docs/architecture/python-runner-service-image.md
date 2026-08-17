# Python Runner service image設計

最終更新: 2026-08-17（Issue #149 / PR #150）

## 目的

PR #148のreview-only staging IaCへ渡せるPython Remote Runner service imageを、再現可能・最小権限・レビュー可能な形でbuildする。

この設計はservice imageのbuildと品質gateまでを対象とし、ECR publishやActual staging deployは含まない。

## Runtime構成

```text
Python Runner service image
  Node.js 22.23.1
  Docker CLI 29.6.2
  apps/python-runner
  packages/runner-sdk
  Python challenge trusted runtime data
        |
        | /var/run/docker.sock
        v
host Docker daemon
        |
        v
pinned Python sandbox image
  network none
  read-only
  non-root 65534:65534
  cap-drop ALL
  no-new-privileges
  CPU / memory / pids / fd / timeout limit
```

Runner control-planeはDocker socketを利用するためrootで起動する。一方、submitted Python codeは既存sandboxでnon-root実行する。root権限をsubmitted codeへ継承させない。

## Base image pinning

Dockerfileではtagだけでなくsha256 digestを固定する。

- Node.js: `node:22.23.1-alpine3.24@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2`
- Docker CLI: `docker:29.6.2-cli-alpine3.24@sha256:be132a9f282288de4afaf63379dff75711fda0147c6b72a9df44e51841402144`

Docker CLI stageから`/usr/local/bin/docker`だけをruntimeへcopyする。runtimeからnpm / npx / yarnを削除し、不要なpackage managerを残さない。

## Challenge packaging

Repositoryの`problems/examples`全体をruntime imageへ直接COPYしない。

`scripts/package-python-runner-problems.mjs`でPython対応Challengeだけを抽出し、次だけを配置する。

- `problem.json`
- `visibleTests`が指すJSON
- `hiddenTests`が指すJSON

次は配置しない。

- starter code
- legacy hidden `.py` test source
- 他言語Challenge
- docs
- `.git`

case pathはrelative `.json`だけを許可する。challenge root外へのpath traversalとsymlinkはbuild前にfail-closed拒否する。

hidden case JSONはtrusted Runner processが期待値比較に利用する。submitted Python sandboxへmountするfilesystemは従来どおり`submission.py`とgeneric `invoke.py`だけであり、hidden case JSON自体はsandboxへ渡さない。

## Service container hardening contract

staging IaCおよびCIで次を維持する。

- read-only root filesystem
- capability drop ALL
- no-new-privileges
- application TaskRoleなし
- Docker socket mountはdedicated Runner hostだけ
- shared workspace pathはhost / service containerで同一絶対path

Docker socketはroot-equivalent権限であるため、このservice imageを通常Workerへ同居させない。

## Image E2E

専用CIは次を実際に実行する。

```text
local service image
  -> hardened service container
  -> HMAC HTTP job
  -> host Docker socket
  -> pinned Python sandbox
  -> python-bugfix-score-buckets reference solution
  -> visible + hidden success
  -> score 100
```

単なる`/health`成功だけではservice imageの完成条件にしない。

## SBOM / vulnerability gate

- Anchore Syftベースの`anchore/sbom-action`でCycloneDX JSONを生成する。
- TrivyでOS/library vulnerability JSONを生成する。
- raw reportをartifactとして保持する。
- HIGH / CRITICALは原則CI failureにする。

### 期限付き例外

初回scanで検出したHIGH 8件はすべてDocker CLI binary内のGo stdlib `1.26.5`由来で、CRITICALは0件だった。

`.trivyignore.yaml`では承認済み8 CVEのみを次のscopeで一時許可する。

- path: `usr/local/bin/docker`
- PURL: `pkg:golang/stdlib@v1.26.5`
- expiry: `2026-09-17`

`scripts/python-runner-trivy-exception-validator.mjs`が次を拒否する。

- 9件目以降のunknown CVE追加
- CVE ID差し替え
- path変更
- PURL wildcard化 / version変更
- expiry延長
- statement変更
- 追加YAML内容

期限到来時はDocker CLI / Go upstream更新状況を再評価し、可能なら例外を削除してimageを更新する。

## 秘密情報境界

- HMAC secretをDockerfileへ書かない。
- build argへsecretを渡さない。
- image layerへAWS credentialを含めない。
- PR CIは`contents: read`だけでAWS permissionを持たない。
- CIのHMAC値はtest-only固定値で本番secretではない。

## 非対象

- ECR repository作成。
- ECR push。
- GitHub OIDC push permission。
- image signing / provenanceのrelease policy確定。
- staging CloudFormation deploy。
- Worker staging wiring。
- Python Public submission有効化。

## 次の依存

PR #150 merge後は、ECR repositoryとimage publish / immutable digest release contractをreview-onlyで実装する。`RunnerServiceImageUri`へ渡す値は必ずregistry digest取得後の`@sha256:` URIとする。
