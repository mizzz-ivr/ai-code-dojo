# Issue #151 Python Runner image release handoff

最終更新: 2026-08-18

## 状態

- Issue: #151
- PR: #152
- Branch: `feat/python-runner-ecr-release`
- Parent: #145
- Depends on: #149 / PR #150
- Actual AWS: 未変更
- Actual ECR push: 未実施
- Python Public submission: OFF

## 完成する契約

Python Runner service imageを次のidentityでstagingへ引き渡す。

```text
main source commit
  -> sha-<40hex> immutable tag
  -> ECR registry digest
  -> repository@sha256:digest
  -> validated release manifest
```

## 主な実装

- review-only ECR repository / publisher role CloudFormation。
- manual publish workflow。
- exact OIDC Environment subject。
- source tag既存時failure。
- build / runtime content / SBOM / Trivy gate後だけpush。
- digest readback。
- release manifest / checksum artifact。
- IaC / workflow / manifest validator。
- lifecycle semantic validator。

## 守るべき境界

- PR #152 mergeだけではAWS resourceを変更しない。
- ECR stack bootstrapは別review +明示承認。
- GitHub Environment作成・protection設定も別運用。
- actual workflow dispatchも明示承認後。
- static AWS keyは使わない。
- publisher roleへdelete/config mutation権限を付与しない。
- Python Public gateを開けない。
- WorkerへDocker socketを公開しない。
- hidden caseをsandbox filesystemへmountしない。

## Actual publish前に必要なGitHub Environment

`staging-python-runner-image`

Protection:

- required reviewer 1名以上。
- main限定。

Variables:

- `AWS_STAGING_REGION`
- `AWS_STAGING_ACCOUNT_ID`
- `AWS_STAGING_PYTHON_RUNNER_ECR_PUBLISH_ROLE_ARN`
- `AWS_STAGING_PYTHON_RUNNER_ECR_URI`

## Publish後の次依存

1. release manifestの`imageUri`を確認。
2. `python-runner-staging-stack.json`の`RunnerServiceImageUri`へdigest URIを渡す。
3. review-only staging change setを確認。
4. 明示承認後にActual staging deploy。
5. Worker wiring。
6. adversarial isolation / quota / cost / rollback test。
7. Python Public gate判定。

## Failure注意

push成功後にmanifest artifactだけ失敗した場合、immutable tagを再pushしない。ECR digestをread-only確認し、manifest generatorで復旧manifestを再生成して別レビューする。

## Trivy期限

Docker CLI Go stdlibの期限付き例外は`2026-09-17`。Actual publish時点で期限・upstream更新を再確認する。
