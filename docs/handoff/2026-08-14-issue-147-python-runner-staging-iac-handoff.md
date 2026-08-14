# Issue #147 handoff: Python Runner staging IaC

## 状態

- Parent: GitHub Issue #145
- Issue: GitHub #147
- Branch: `feat/python-runner-staging-iac`
- Linear: Free issue上限のため作成不可
- Actual AWS: 未適用
- Python Public gate: OFF

## 実装範囲

review-only CloudFormationとして次を定義する。

- dedicated ECS cluster
- ECS optimized AL2023 EC2 host
- ASG 1台固定
- ECS EC2 Runner service 1 task固定
- internal ALB + HTTPS
- private Route53 alias
- generated Secrets Manager HMAC secret
- Runner Client / ALB / Host専用SG
- task execution IAM
- CloudWatch Logs
- Docker socket / shared workspace bind mounts

## 重要な設計制約

現行`apps/python-runner`はhost Docker daemonへ依存するためFargateへ直接移さない。AWS ECSのEC2-hosted taskだけで`host.sourcePath`を使用し、Docker socketへのroot-equivalent権限は専用Runner host内に限定する。

WorkerにはDocker socketを渡さない。

## Runtime path

```text
Worker + RunnerClientSG
  -> HTTPS 443
internal ALB
  -> HTTP 8090
Dedicated ECS/EC2 Runner host
  -> apps/python-runner
  -> host Docker daemon
  -> non-root Python sandbox
```

## Deployment前に必要なもの

- staging VPC
- 2 AZ以上のprivate subnet
- private hosted zone
- ACM certificate
- private ECRのdigest固定Runner service image
- private subnetから必要なHTTPS egress経路
- Runner Client SGをstaging Workerへattachするservice wiring
- Worker側の同一Secrets Manager secret injection

## 次のgate

1. PR merge
2. AWS `validate-template`
3. change setレビュー
4. ユーザー明示承認
5. staging deploy
6. adversarial isolation test
7. cost / concurrency / rollback検証
8. その後に別PRでPython Public gateを検討

## 非対象

- Actual AWS resource作成
- Python Public allowlist変更
- DB / queue transport cutover
- Docker socketを廃止するjob-per-task executor再設計
