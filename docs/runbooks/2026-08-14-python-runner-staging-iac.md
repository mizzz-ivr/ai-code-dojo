# Python Remote Runner staging IaC runbook

作成日: 2026-08-14
対象: Issue #147

## 目的

`infra/aws/cloudformation/python-runner-staging-stack.json`を安全にレビューし、Actual AWS適用前のchange setまで確認する手順を定義する。

**このrunbookを読んだだけではdeployしない。change setのexecuteはユーザーの明示承認後だけ行う。**

## 1. Repository validation

```bash
pnpm infra:validate
pnpm test:unit
```

確認対象:

- Fargate / awsvpcへ変更されていない
- Runner ALBがinternal
- public ingress / public IP / SSHなし
- dedicated Runner Client SGからのみHTTPS 443
- Runner hostはALBから8090のみ
- ASG / service / concurrency上限が拡大されていない
- HMAC secretがplaintext化されていない
- task execution roleがsecret以外へ権限拡大していない
- ECS Privilegedがfalse
- read-only / capability drop / no-new-privilegesが維持されている

## 2. AWS template validation

AWS credentialsを使うのはreview担当者が明示的に選択した環境だけとする。

```bash
aws cloudformation validate-template \
  --template-body file://infra/aws/cloudformation/python-runner-staging-stack.json \
  --region <staging-region>
```

このコマンドはtemplate validationのみでresourceを作成しない。

## 3. change set前提条件

以下が揃うまでchange setを作らない。

- staging VPC ID
- internal ALB用に2 AZ以上のprivate subnet ID
- private hosted zone ID
- Runner private FQDN
- FQDNをカバーする同一regionのACM certificate ARN
- private ECRにpush済みのRunner service image URI（`@sha256:<digest>`必須）
- Runner service imageにNode.js runtime / Docker CLI / Repository runtime files / `problems/examples`が含まれること
- private subnetから必要なAWS control planeとsandbox image取得先へHTTPS到達できること
- NAT Gatewayまたは必要なVPC endpoint等の既存egress経路

現行Python sandbox imageはDocker Hub上のdigest固定imageを参照するため、host cacheに存在しない場合はDocker daemonがその取得先へ到達できる必要がある。将来的にはECR mirror / executor backend分離を検討する。

## 4. change set作成（review-only）

例:

```bash
aws cloudformation create-change-set \
  --stack-name ai-code-dojo-staging-python-runner \
  --change-set-name review-<timestamp> \
  --change-set-type CREATE \
  --template-body file://infra/aws/cloudformation/python-runner-staging-stack.json \
  --capabilities CAPABILITY_IAM \
  --parameters \
    ParameterKey=VpcId,ParameterValue=<vpc-id> \
    ParameterKey=PrivateSubnetIds,ParameterValue='<subnet-a>\,<subnet-b>' \
    ParameterKey=PrivateHostedZoneId,ParameterValue=<hosted-zone-id> \
    ParameterKey=RunnerDnsName,ParameterValue=<private-fqdn> \
    ParameterKey=CertificateArn,ParameterValue=<certificate-arn> \
    ParameterKey=RunnerServiceImageUri,ParameterValue=<ecr-uri@sha256:digest> \
  --region <staging-region>
```

**ここで止める。`execute-change-set`は実行しない。**

## 5. change set review

```bash
aws cloudformation describe-change-set \
  --stack-name ai-code-dojo-staging-python-runner \
  --change-set-name review-<timestamp> \
  --region <staging-region>
```

最低限確認する項目:

- public ALBではない
- EC2 public IPなし
- SSH key / port 22なし
- ASG 1台固定
- ECS service 1 task固定
- unexpected IAM policyなし
- secret値がoutputに出ない
- Runner Client SG → ALB 443 → host 8090以外のinbound経路がない
- host egressがTCP 443だけ
- Route53 recordがprivate hosted zone内
- Delete/ReplaceでRetain対象が意図どおりか

## 6. 明示承認後のstaging検証

Actual deployは別作業として扱う。承認後にresourceを作成した場合でもPython Public gateはOFFのままにする。

実施すべきadversarial test:

1. `/workspace`走査でhidden test / case / expected valueが見えない
2. sandboxから外部networkへ接続できない
3. root filesystem / workspaceを書き換えられない
4. capability / privilege escalationができない
5. fork bomb / memory pressure / file descriptor枯渇が制限される
6. infinite loopがtimeoutしcontainerが残存しない
7. Runner再起動時にorphan containerがcleanupされる
8. invalid HMAC / clock skew / idempotency conflictが拒否される
9. concurrency=1 / queue=2超過が429になる
10. user-code failureがinfra retryされない

## 7. rollback

stagingで問題が発生した場合:

1. Workerの`PYTHON_REMOTE_RUNNER_URL`接続を無効化する。
2. Python Public gateがOFFであることを再確認する。
3. ECS service desired countを0にする、またはstack rollbackを行う。
4. ALB / hostへのtrafficが停止したことを確認する。
5. orphan sandbox containerが残っていないことを確認する。
6. CloudWatch Logsを保全する。
7. Retainされたsecretを即削除せず、incident review後に扱う。

## 8. 実行してはいけないこと

- reviewなしの`execute-change-set`
- Python Public allowlistの同時変更
- WorkerへのDocker socket mount
- DB cutoverやSQS transport cutoverとの同時実施
- Runner hostへのSSH開放
- secret値のGitHub / Notion / CloudFormation outputへの貼り付け
