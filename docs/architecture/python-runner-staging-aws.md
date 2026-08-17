# Python Remote Runner staging AWS設計

最終更新: 2026-08-14（Issue #147）

## 目的

PR #146で導入した`apps/python-runner`を、Python Public submissionをまだ有効化せず、stagingで隔離・攻撃耐性を検証できるAWS構成として定義する。

この設計は**review-only IaC**までを対象とし、Actual AWS resource作成は含まない。

## 前提・制約

現行Python Remote RunnerはNode.js control planeからhost Docker daemonへ`docker run`を実行し、提出コードごとに固定Python sandbox containerを起動する。

そのため、Runner control plane自身には次の2つが必要になる。

- `/var/run/docker.sock`
- sandbox workspaceをhost Docker daemonから同じpathで参照できる共有directory

AWS ECSの`host.sourcePath`はEC2-hosted taskでは利用できるがFargateでは利用できない。このためIssue #147ではFargateへ見かけ上移すのではなく、現行runtime contractに接続できる**専用ECS/EC2 host**を採用する。

## 推奨構成

```text
staging Worker
  + RunnerClientSecurityGroup
        |
        | HTTPS :443 / HMAC
        v
internal ALB
  + RunnerAlbSecurityGroup
        |
        | HTTP :8090 / private VPC only
        v
Dedicated ECS/EC2 Runner host (1台固定)
  + RunnerHostSecurityGroup
        |
        + ECS task: apps/python-runner
        |   - read-only root filesystem
        |   - cap-drop ALL
        |   - no-new-privileges
        |   - Docker socket mount
        |   - shared workspace mount
        |
        + host Docker daemon
              |
              + Python sandbox
                  - network none
                  - read-only
                  - non-root
                  - CPU / memory / pids / fd / timeout limit
                  - submission.py + generic invoke.py only
```

## Network boundary

### Runner Client SG

staging Workerへ追加attachする専用SGをstack側で作る。

- inbound: なし
- outbound: Runner ALB SGのTCP 443のみ
- ALB側もこのSGからの443だけを許可

既存Worker SGをstackから直接変更しない。既存SGのrule setと合成した際の意図しない権限拡大を避け、Runner接続権限を専用SGのattach有無でレビューできるようにする。

### Internal ALB

- `Scheme=internal`
- private subnets
- HTTPS 443のみ
- ACM certificate parameter
- TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06`
- invalid HTTP headerをdrop
- targetは専用EC2 hostの8090

ALBからRunner hostへの経路はSG参照でTCP 8090だけを許可する。

### Runner host

- public IPなし
- SSH key pairなし
- inboundはALB SGから8090のみ
- outboundはTCP 443のみ

private subnetからECS/ECR/Secrets Manager/CloudWatch Logs/SSM、および現行sandbox image取得先へ到達できるHTTPS egress経路が必要になる。NAT Gatewayや必要なVPC endpointの新設はこのstackの責務に含めず、既存staging networkの前提条件としてchange set実行前に確認する。

## Compute / cost boundary

stagingではresource上限をIaCとvalidatorの両方で固定する。

- Auto Scaling group: Min=1 / Max=1 / Desired=1
- instance type: `t3.small`または`t3.medium`のみ
- ECS service DesiredCount=1
- Python Runner app max concurrency=1
- queue=2

1 host上で固定HostPort 8090を使用するため、deploymentは`MaximumPercent=100` / `MinimumHealthyPercent=0`とする。stagingでは短時間の切替停止を許容し、同一hostへ2 taskを同時配置しない。

## Docker socket例外

Docker socketはhost root相当の強い権限であり、一般的なmulti-tenant Workerへ渡してはいけない。

Issue #147では次をセットで必須条件とする。

- WorkerにはDocker socketを渡さない。
- Runner hostを専用hostにし、他workloadを置かない。
- Docker socketを持つのは`apps/python-runner` control plane taskだけ。
- ECS `Privileged`はfalse。
- control plane root filesystemはread-only。
- capabilityはALL drop。
- `no-new-privileges`を有効化。
- application TaskRoleは付与しない。
- Docker socketアクセスのためcontrol plane userは明示的にUID 0とする。
- 実際のsubmitted Python codeは別sandboxでnon-root実行する。

これは最終理想形ではなく、現行Docker executorを安全にstaging検証するための限定的なbridge設計である。

## Workspace boundary

hostとRunner control planeの双方で以下を同じpathとして使用する。

`/var/lib/ai-code-dojo/python-runner-workspaces`

Runner taskは`TMPDIR`もこのpathへ向ける。Node.jsが作成した一時workspaceのhost実体を、host Docker daemonの`-v <path>:/workspace:ro`から同一pathで解決できるようにするためである。

hidden case / expected valueはこのworkspaceへ書かず、PR #146で導入したtrusted Node comparator側に保持する。

## Secret / IAM boundary

- HMAC shared secretは`AWS::SecretsManager::Secret`で64文字を自動生成する。
- secret値をparameter、output、Repositoryへ保存しない。
- Runner task execution roleには標準ECS task execution policyと、当該secretへの`secretsmanager:GetSecretValue`だけを追加する。
- Runner application taskにはTaskRoleを与えない。
- secret ARNだけをoutputし、staging Worker側の将来service wiringで同じsecretをsecret injectionする。
- secret rotation後はWorker / Runner双方のtask再起動が必要になるため、rotation手順はActual staging wiring時に確定する。

## EC2 host hardening

- ECS optimized Amazon Linux 2023 recommended AMIをSSM parameterから取得
- IMDSv2 required
- metadata hop limit=1
- public IPなし
- SSH keyなし
- encrypted gp3 root volume
- SSM Session Manager用managed policyのみ追加
- dedicated shared workspaceを0700で作成

## Health / rollback

- `/health`をALB target health checkに使用する。
- ECS deployment circuit breaker + rollbackを有効化する。
- CloudWatch Logsは7日保持、LogGroupはRetain。
- shared HMAC secretもRetainとする。

## Public gate

このstackがmergeされてもPython Public submissionは有効化しない。

解除条件:

1. change setレビュー
2. ユーザー明示承認
3. staging resource作成
4. WorkerへRunner Client SG / URL / shared secretを安全に配布
5. hidden filesystem leak test
6. outbound network遮断test
7. privilege / filesystem / resource limit test
8. timeout / orphan cleanup test
9. concurrent / overload / cost test
10. rollback確認

すべて通過後に、別PRでPython public allowlistを変更する。

## 将来の強化案

より強い最終構成はDocker socketそのものを廃止し、Remote Runner control planeが提出ごとにECS RunTask / AWS Batch等の隔離jobを起動するexecutor backendへ移行すること。

この変更はexecutor contract・latency・cost・idempotencyの再設計を伴うためIssue #147へ混在させない。
