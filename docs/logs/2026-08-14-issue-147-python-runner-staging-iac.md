# Issue #147 実装ログ: Python Runner staging IaC

作成日: 2026-08-14

## 目的

PR #146で完成したPython Remote Runner code boundaryを、Actual AWSへまだ適用せずreview可能なstaging CloudFormationへ落とす。

## Issue管理

Linear作成を先に試行したがFree workspaceのactive Issue上限で失敗したため、既定方針どおりGitHub Issue #147を正本とした。

## 設計判断

### Fargateを採用しない

現行Runnerはhost Docker daemonとhost `sourcePath` bind mountを必要とする。Fargateはこの`sourcePath` contractを満たさないため、専用ECS/EC2 hostを採用した。

### Worker既存SGを直接変更しない

当初は既存Worker SGへRunner向けegress ruleを追加する案だった。しかし既存ruleと合成され、Runner access権限がSG単位で明確にならない。

修正後は`RunnerClientSecurityGroup`をstack内で作成し、Actual Worker wiring時に明示attachする。ALB側はこの専用SGからの443だけを許可する。

### SG default egressを残さない

SG作成時にegressを指定しないとdefault allow-all egressが追加されるため、Runner Client / ALB SGはloopback-only placeholderでdefault egressを抑止し、実際のSG間egressをstandalone ruleで定義する。

### Docker socket例外

Docker socket自体がhost root相当であるため、Runner control plane taskは専用host限定とし、co-tenantなし・ECS Privileged=false・read-only root・capability drop ALL・no-new-privileges・TaskRoleなしを必須化した。

Docker socketへ接続するcontrol plane userは明示UID 0とする一方、提出Pythonコードは既存sandbox contractどおりnon-rootを維持する。

## 実装

- `python-runner-staging-stack.json`
- staging CloudFormation validator
- validator CLI
- unit tests
- `pnpm infra:validate`統合
- CloudFormation README更新
- architecture / runbook / handoff / current-status / active-issues更新

## Validatorで拒否する代表例

- Fargate / awsvpc
- public ALB ingress
- public IP
- SSH key / port 22
- ASG 2台以上
- ECS service desired count 2以上
- Runner concurrency / queue上限拡大
- plaintext secret
- secret IAM wildcard
- Docker socket / shared workspace contract破壊
- HTTP listener / TLS downgrade
- digest未固定Runner service image
- ECS Privileged
- writable root filesystem
- capability復活

## Actual AWS境界

このIssueではAWS resourceを作成しない。merge後もPython Public submissionはOFFを維持する。
