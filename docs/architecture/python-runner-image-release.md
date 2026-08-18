# Python Runner image release設計

最終更新: 2026-08-18（Issue #151 / PR #152）

## 目的

Python Runner service imageを、source commitとAmazon ECR上のregistry digestを追跡可能な形でstagingへ受け渡す。

この設計は次を分離する。

1. Repository内でのreview-only IaC / workflow contract。
2. 明示承認後のECR stack bootstrap。
3. 明示承認後のmanual image publish。
4. release manifestを使ったPython Runner staging change set。
5. staging adversarial test後のPublic gate判断。

PR #152のmergeだけではAWS resourceもimageも変更しない。

## Release identity

release identityはmutable tagではなく次の組み合わせで固定する。

```text
source commit
  -> sha-<40hex commit> immutable ECR tag
  -> ECR registry digest sha256:<64hex>
  -> repository@sha256:<64hex>
  -> release manifest artifact
```

staging IaCへ渡すのはtag URIではなく`repository@sha256:digest`だけとする。

## ECR repository contract

Repository: `ai-code-dojo-staging-python-runner`

- `ImageTagMutability=IMMUTABLE`。
- tag mutability exclusionなし。
- scan-on-push有効。
- AES256 encryption。
- `DeletionPolicy=Retain`。
- `UpdateReplacePolicy=Retain`。
- `EmptyOnDelete=false`。
- lifecycleはuntagged imageを7日後にexpireするだけ。
- tagged releaseをlifecycleで自動削除しない。
- broad repository policyは追加しない。

registry-level scanning configurationはAWS account全体へ作用し得るため、このIssueでは変更しない。publish前Trivy gateとrepository scan-on-pushを維持し、registry-level scanningは別のaccount-wide security changeとして扱う。

## Publisher IAM boundary

GitHub Actions publisher roleはdedicated GitHub EnvironmentのOIDC subjectだけをtrustする。

Environment: `staging-python-runner-image`

許可するrepository action:

- layer availability確認。
- layer upload開始 / upload /完了。
- `PutImage`。
- repository / image / lifecycle readback。

`ecr:GetAuthorizationToken`はAWS API契約上repository ARNへresource scopeできないため`Resource: *`とする。それ以外のactionは`PythonRunnerImageRepository` ARNだけへ限定する。

許可しない代表例:

- repository create/delete。
- image delete。
- tag mutability変更。
- scanning設定変更。
- lifecycle変更。
- repository policy変更。
- IAM / CloudFormation操作。

## GitHub publish boundary

`publish-python-runner-staging-image.yml`はmanual `workflow_dispatch`専用。

実行にはすべて必要:

- refが`refs/heads/main`。
- inputへ`PUBLISH_STAGING_PYTHON_RUNNER_IMAGE`を手入力。
- GitHub Environment `staging-python-runner-image`を通過。
- Environment variablesが完全。
- OIDCで想定accountへassumeできる。

OIDC session durationは900秒とする。

GitHub Environment側ではActual利用前にrequired reviewerを設定し、deployment branchを`main`だけへ制限する。RepositoryコードだけではEnvironment protection rules自体を強制できないため、これはbootstrap時の必須運用条件とする。

## Required GitHub Environment variables

`staging-python-runner-image`へ次を設定する。

- `AWS_STAGING_REGION`
- `AWS_STAGING_ACCOUNT_ID`
- `AWS_STAGING_PYTHON_RUNNER_ECR_PUBLISH_ROLE_ARN`
- `AWS_STAGING_PYTHON_RUNNER_ECR_URI`

long-lived AWS access keyは設定しない。

## Pre-publish gate

AWS credential取得後、pushより前に次をfail-closed検証する。

1. repository URIがEnvironment variableと一致。
2. tag mutabilityが`IMMUTABLE`。
3. scan-on-push有効。
4. encryptionがAES256。
5. lifecycle policyがsemantic contractと一致。
6. `sha-<source commit>` tagが存在しない。
7. service image build成功。
8. runtime content contract成功。
9. CycloneDX SBOM生成。
10. raw Trivy report生成。
11. HIGH / CRITICAL gate成功。
12. 期限付きTrivy例外contract成功。

既存tagを上書き・再利用しない。

## Publish / digest readback

quality gate成功後だけDocker login / pushを行う。

push tag:

```text
sha-<GITHUB_SHA>
```

push後にECR `DescribeImages`からdigestをreadbackする。digestは`sha256:<64 lower hex>`以外を拒否する。

## Release manifest

manifest schemaVersion=1。

固定field:

- `schemaVersion`
- `artifact`
- `environment`
- `sourceRepository`
- `sourceRef`
- `sourceCommit`
- `repositoryUri`
- `imageTag`
- `imageDigest`
- `imageUri`
- `workflowRunId`
- `workflowRunAttempt`

`imageUri`は必ず:

```text
<repositoryUri>@<imageDigest>
```

manifestとそのSHA-256 checksumを90日artifactとして保存する。

## Failure boundary

### push前failure

ECR imageは変更されない。原因修正後に同source commitでworkflowを再実行できる。

### push中failure

immutable repositoryにより、同tagの競合・部分的なmanifest置換を許容しない。実行結果をECR側と照合してから再実行判断する。

### push成功後 / manifest artifact failure

image tagは既にimmutableなため自動overwriteしない。workflowを盲目的に再pushしない。

復旧ではECRの`DescribeImages`をread-onlyで確認し、source commit tagとregistry digestを取得した上で、Repositoryのmanifest generatorを使ってrelease manifestを再生成する。復旧操作はrunbookに従い、対象tag/digestをレビューしてから行う。

## Staging deployment handoff

manual publishで生成したrelease manifestの`imageUri`を、`python-runner-staging-stack.json`の`RunnerServiceImageUri`へ渡す。

publish workflow自体はCloudFormation change setを作成・実行しない。

## 非対象

- Actual ECR stack apply。
- GitHub Environment自動作成。
- Actual image publish。
- Runner staging deploy。
- Worker wiring。
- Python Public allowlist有効化。
- ECR registry-level scanning configuration変更。
- image signing / provenance attestation。

## 将来強化

staging運用が安定した後、image signing / provenance attestationを導入し、digestだけでなくbuild provenanceも検証対象にする。
