# Python Runner image release runbook

最終更新: 2026-08-18（Issue #151 / PR #152）

## 目的

Python Runner service imageを、review済みsource commitからprivate ECRへpublishし、digest固定URIをstaging deployへ引き渡す手順を定義する。

このrunbookのActual AWS操作は、PR #152 mergeとは別にレビューと明示承認を得た後だけ実施する。

## 0. PR #152 merge時点

mergeだけでは次は起きない。

- ECR repository作成。
- IAM publisher role作成。
- GitHub Environment作成。
- image push。
- staging deploy。
- Python Public gate変更。

## 1. ECR release stack bootstrap前レビュー

対象template:

`infra/aws/cloudformation/python-runner-image-release-stack.json`

確認する。

- RepositoryNameが`ai-code-dojo-staging-python-runner`固定。
- tagは完全IMMUTABLE。
- mutability exclusionなし。
- scan-on-push=true。
- AES256。
- Retain / EmptyOnDelete=false。
- lifecycleがuntagged 7日だけ。
- publisher role trustが`staging-python-runner-image` Environment subjectだけ。
- `GetAuthorizationToken`以外のECR actionがrepository ARN限定。
- repository delete/config mutation権限なし。

Repository validator:

```bash
pnpm infra:validate
```

Actual stack applyはこの確認後に別途明示承認を得る。

## 2. GitHub Environment bootstrap

Environment名:

`staging-python-runner-image`

Actual image publish前にGitHub UIで次を設定する。

### Protection rules

- required reviewerを1名以上設定する。
- deployment branch / tag policyは`main`だけを許可する。
- 不要なadministrator bypassを許可しない運用を推奨する。

### Variables

- `AWS_STAGING_REGION`
- `AWS_STAGING_ACCOUNT_ID`
- `AWS_STAGING_PYTHON_RUNNER_ECR_PUBLISH_ROLE_ARN`
- `AWS_STAGING_PYTHON_RUNNER_ECR_URI`

publisher role ARNとrepository URIはActual ECR release stackのOutputsから取得する。

設定しないもの:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`

## 3. Actual publish前確認

mainの対象commitを確定する。

確認項目:

- 対象commitがレビュー済みmain commitである。
- PR CIがgreen。
- `.trivyignore.yaml`の期限が切れていない。
- Python Runner service imageのDockerfile / trusted runtime dataが想定どおり。
- ECR release stack / Environment variablesにdriftがない。
- Python Public gateはOFF。

## 4. Manual publish

GitHub Actionsから`publish-python-runner-staging-image`をmainに対して手動起動する。

入力:

```text
PUBLISH_STAGING_PYTHON_RUNNER_IMAGE
```

workflowは次を自動検証する。

1. main ref。
2. confirmation phrase。
3. dedicated Environment approval。
4. OIDC / expected account。
5. repository URI / IMMUTABLE / scan / encryption / lifecycle。
6. source commit tag未使用。
7. image build / runtime content。
8. SBOM / raw Trivy。
9. HIGH / CRITICAL gate。
10. ECR push。
11. registry digest readback。
12. release manifest / checksum artifact。

## 5. Publish結果レビュー

workflow summaryで次を確認する。

- source commit。
- immutable tag `sha-<commit>`。
- registry digest。
- staging deployが未実施であること。
- Python Public gateがOFFであること。

artifact:

- pre-publish SBOM。
- raw Trivy JSON。
- `python-runner-image-release-<commit>`。

release manifestの`sourceCommit` / `imageTag` / `imageDigest` / `imageUri`を照合する。

## 6. Staging change setへの受け渡し

manifestの`imageUri`だけを`RunnerServiceImageUri`へ使用する。

禁止:

- `:latest`
- `:sha-...` tag URIだけでのdeploy
- local image ID
- digestなしECR URI

Python Runner staging stackのActual change set作成・実行は別のreview/approval手順で行う。

## 7. Failure対応

### OIDC / account mismatch

publishしない。Environment variable、OIDC subject、対象AWS accountを確認する。static access keyで迂回しない。

### Repository drift

publishしない。IMMUTABLE / scan-on-push / encryption / lifecycleの差異を先に解消し、再レビューする。publish workflowからrepository設定を変更しない。

### Existing source tag

publishしない。同tagを上書き・削除してやり直さない。

ECRでtag/digestをread-only確認し、過去workflow runと照合する。意図しないimageならsecurity incident候補として扱う。

### Trivy failure

publishしない。新しいHIGH / CRITICALをignoreへ自動追加しない。修正版imageへ更新するか、例外が必要ならCVE / path / PURL /期限を明示した別レビューを行う。

### Push成功後にmanifest artifactだけ失敗

同tagはimmutableなので再pushしない。

1. ECR `DescribeImages`で`sha-<sourceCommit>`のdigestをread-only確認する。
2. 対象workflow run / commitと一致するかレビューする。
3. 必要な環境値を明示して`create-python-runner-image-release-manifest.mjs`でmanifestを再生成する。
4. checksumを再生成する。
5. 復旧manifestをstaging change setへ渡す前に別レビューする。

この復旧は通常publish pathではなく例外運用として記録する。

## 8. Rollback

staging deploy後にrollbackが必要な場合、既知の正常release manifestに記録された過去digest URIへ戻す。

immutable tagや既存imageを上書きしない。

ECR image削除はpublisher roleに許可していない。削除が必要な場合は別の管理者承認手順とする。

## 9. Python Public gate

image publish成功だけではPythonを公開しない。

次が残る。

- Runner staging deploy。
- Worker wiring。
- adversarial isolation test。
- quota / concurrency / cost確認。
- secret rotation / rollback確認。

これらの完了後にPublic allowlist変更を別PRで判断する。
