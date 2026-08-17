# Python Runner service image runbook

最終更新: 2026-08-17（Issue #149 / PR #150）

## 目的

Python Remote Runner service imageのbuild・local contract・SBOM・Trivy結果を確認する。Actual AWS / ECRへのpushはこのrunbookでは行わない。

## 前提

- Docker daemonが利用可能であること。
- Node.js 22系が利用可能であること。
- Repository rootで実行すること。
- Python Public gateはOFFのままにすること。

## Local build

```bash
docker build \
  --file apps/python-runner/Dockerfile \
  --tag local/ai-code-dojo-python-runner:review \
  .
```

DockerfileはNode.js / Docker CLI base imageをsha256 digest固定する。

## Runtime content確認

```bash
docker run --rm --entrypoint sh local/ai-code-dojo-python-runner:review -ec '
  node --version
  docker --version
  ! command -v npm
  ! command -v yarn
  test -f /app/problems/examples/python-bugfix-score-buckets/problem.json
  test -f /app/problems/examples/python-bugfix-score-buckets/tests/visible/score_visible_cases.json
  test -f /app/problems/examples/python-bugfix-score-buckets/tests/hidden/score_hidden_cases.json
  test ! -e /app/problems/examples/python-bugfix-score-buckets/tests/hidden/score_hidden_test.py
  test ! -e /app/problems/examples/python-bugfix-score-buckets/starter/score.py
'
```

## Packager test

```bash
node --test tests/unit/python-runner-image-packager.test.mjs
```

確認事項:

- Python対応Challengeだけをpackageする。
- starter / legacy hidden `.py`を含めない。
- traversalを拒否する。
- symlinkを拒否する。

## Trivy例外contract test

```bash
node --test tests/unit/python-runner-trivy-exception-validator.test.mjs
```

`.trivyignore.yaml`は承認済みDocker CLI Go stdlib CVE 8件だけを許可する。path / PURL / expiry / statementを変更した場合はtest failureにする。

expiryは`2026-09-17`。期限延長を自動で行わない。

## Service image E2E

GitHub Actions `python-runner-image-quality`が正本のE2E。

CIでは次を行う。

1. pinned service image build。
2. pinned Python sandbox image pull。
3. host shared workspace作成。
4. service containerをread-only / cap-drop ALL / no-new-privilegesで起動。
5. `/var/run/docker.sock`をservice containerだけへmount。
6. HMAC付きjobを送信。
7. service container内Docker CLIからhost daemonへ`docker run`。
8. pinned Python sandboxでreference solutionを実行。
9. visible / hidden suite成功、score 100を確認。
10. orphan container / workspace cleanup。

## SBOM / scan

専用workflowで次のartifactを生成する。

- `python-runner-sbom`: CycloneDX JSON。
- `python-runner-trivy`: raw Trivy JSON。

security gateはHIGH / CRITICALを対象とし、`.trivyignore.yaml`の期限付き例外以外はfailureにする。

## Trivy例外の更新手順

1. raw Trivy artifactでCVE、package、installed/fixed versionを確認する。
2. upstream stable Docker CLI / Goで解消可能か確認する。
3. 解消可能ならbase image / Docker CLIを更新し、例外を削除する。
4. 解消不可の場合でもunknown CVEを自動追加しない。
5. 例外追加または期限変更が必要な場合は、根拠と期限を別レビュー対象として明示する。
6. validator unit testも同時に変更する。

## 失敗時の切り分け

### Docker build failure

- pinned digestが取得可能か。
- Dockerfile contextに必要fileがあるか。
- packagerがChallenge metadata / case pathを拒否していないか。

### Service health failure

- shared secretが32文字以上か。
- workspace pathがhostとcontainerで同一か。
- read-only root filesystem以外に書込み先を要求していないか。

### Sandbox failure

- Docker socketがmountされているか。
- sandbox imageが事前pullされているか。
- workspace directory/file permissionがnon-root sandboxからread可能か。

### Trivy gate failure

- raw reportを確認する。
- 新規HIGH / CRITICALは原則修正する。
- `.trivyignore.yaml`をwildcard化して回避しない。

## AWS / ECR境界

このrunbookから以下を実行しない。

- `aws ecr create-repository`
- `docker push`
- AWS credential設定
- CloudFormation `execute-change-set`
- staging deploy

ECR publishは次タスクでreview-only contractとして別管理する。
