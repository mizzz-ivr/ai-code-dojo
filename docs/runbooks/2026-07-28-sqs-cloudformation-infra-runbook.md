# SQS CloudFormation infrastructure runbook

## 目的

`infra/aws/cloudformation/sqs-queue-stack.json`を用いて、ai-code-dojoのgrading source queue、DLQ、RedrivePolicy、TLS deny、producer / consumer workload roleを安全に検証・変更する。

本runbookはchange setによる事前確認を必須とし、Repository CIから実AWS resourceを作成しない。

## 対象resource

- Source SQS queue
- Dead-letter queue
- Source queue `RedrivePolicy`
- DLQ `RedriveAllowPolicy`
- Source / DLQ共通TLS deny queue policy
- Producer workload role
- Consumer workload role

## 非対象

- ECS / Lambda / EC2 workload
- VPC endpoint / subnet / security group
- GitHub OIDC provider / deployment role
- Customer managed KMS key
- Production transport切替
- DLQ replay / purge automation
- Queue metrics / alert

## Templateの既定値

| 項目 | 既定値 |
|---|---:|
| QueueType | `standard` |
| Source retention | 345600秒（4日） |
| DLQ retention | 1209600秒（14日） |
| Long polling | 20秒 |
| Visibility timeout | 90秒 |
| MaxReceiveCount | 5 |
| Workload trust principal | `ecs-tasks.amazonaws.com` |
| Encryption | SQS-managed SSE |

## 不変条件

- Source queueとDLQは同じqueue typeにする。
- FIFO queue名はsource / DLQ双方を`.fifo`で終える。
- DLQは`RedriveAllowPolicy=byQueue`とし、このsource queueだけを許可する。
- Producer roleはsource queueへの`SendMessage`だけを許可する。
- Consumer roleはsource queueへの`ReceiveMessage` / `DeleteMessage` / `ChangeMessageVisibility`だけを許可する。
- Producer / consumer roleへDLQ read、PurgeQueue、queue管理、wildcard resourceを付与しない。
- Source / DLQの削除・置換時は`Retain`する。
- Queue visibilityへ採点correctnessを依存せず、DB processing lease / attempt fencing / completion guardを維持する。
- HTTP producer / consumerをrollback先として維持する。

## 事前確認

1. AWS CLI v2が利用できる。
2. 対象account / regionを明示している。
3. 操作者がCloudFormation、SQS、IAM role作成に必要な権限を持つ。
4. IAM resourceを含むため、deploy時に`CAPABILITY_IAM`を明示する。
5. Stack名と`EnvironmentName`が既存環境と衝突しない。
6. `QueueType`を確認する。
7. WorkloadがECS task以外の場合は`WorkloadServicePrincipal`を確認する。
8. Production workloadはHTTP transportのままとし、resource作成とruntime切替を同時に行わない。

## Local static validation

```bash
pnpm install --frozen-lockfile
pnpm infra:validate
pnpm test:unit
```

Static validatorは以下を確認する。

- CloudFormation JSON構文
- Standard / FIFO condition
- Source / DLQ type・命名
- SQS-managed SSE
- Retention / long polling / visibility
- RedrivePolicy / RedriveAllowPolicy
- Source ARN組み立てによる循環依存回避
- TLS deny policy
- Producer / consumer IAM action・resource完全一致
- Wildcard resource・危険action不在
- Stack outputs
- Literal account ID / access key ID不在

## AWS CloudFormation syntax validation

```bash
aws cloudformation validate-template \
  --template-body file://infra/aws/cloudformation/sqs-queue-stack.json \
  --region ap-northeast-1
```

`validate-template`は主にtemplate構文を検証する。実resourceの作成可能性、account policy、quota、queue名衝突、IAM permissionはchange setとstack operationで別途確認する。

## CREATE change set

変数例:

```bash
export AWS_REGION=ap-northeast-1
export STACK_NAME=ai-code-dojo-dev-queue
export CHANGE_SET_NAME=issue-125-create-preview
```

Standard queue:

```bash
aws cloudformation create-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --change-set-type CREATE \
  --template-body file://infra/aws/cloudformation/sqs-queue-stack.json \
  --capabilities CAPABILITY_IAM \
  --parameters \
    ParameterKey=EnvironmentName,ParameterValue=dev \
    ParameterKey=QueueType,ParameterValue=standard \
    ParameterKey=MaxReceiveCount,ParameterValue=5 \
    ParameterKey=WorkloadServicePrincipal,ParameterValue=ecs-tasks.amazonaws.com \
  --region "$AWS_REGION"
```

FIFO queueでは`QueueType=fifo`へ変更する。Source / DLQ名はtemplateが`.fifo`付きで生成する。

## UPDATE change set

```bash
export CHANGE_SET_NAME=issue-125-update-preview

aws cloudformation create-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --change-set-type UPDATE \
  --template-body file://infra/aws/cloudformation/sqs-queue-stack.json \
  --capabilities CAPABILITY_IAM \
  --parameters \
    ParameterKey=EnvironmentName,UsePreviousValue=true \
    ParameterKey=QueueType,UsePreviousValue=true \
    ParameterKey=MaxReceiveCount,ParameterValue=5 \
    ParameterKey=WorkloadServicePrincipal,UsePreviousValue=true \
  --region "$AWS_REGION"
```

## Change set review

```bash
aws cloudformation wait change-set-create-complete \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --region "$AWS_REGION"

aws cloudformation describe-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --region "$AWS_REGION"
```

レビュー観点:

- 予期しないresource replacementがない。
- Source / DLQ両方のtypeが一致する。
- Queue policyがTLS denyだけである。
- Producer / consumer roleに権限追加がない。
- DLQ read / PurgeQueue / queue管理権限がない。
- Queue名・account・regionが対象環境と一致する。
- `MaxReceiveCount`変更が運用意図と一致する。
- `Retain`対象resourceを理解している。

不要なchange setは実行せず削除する。

```bash
aws cloudformation delete-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --region "$AWS_REGION"
```

## Change set execute

承認後のみ実行する。

```bash
aws cloudformation execute-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --region "$AWS_REGION"
```

CREATEの場合:

```bash
aws cloudformation wait stack-create-complete \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"
```

UPDATEの場合:

```bash
aws cloudformation wait stack-update-complete \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"
```

## Outputs確認

```bash
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output table \
  --region "$AWS_REGION"
```

主なoutput:

- `SourceQueueUrl`
- `SourceQueueArn`
- `DeadLetterQueueUrl`
- `DeadLetterQueueArn`
- `ProducerRoleArn`
- `ConsumerRoleArn`
- `ApiRuntimeConfiguration`
- `WorkerRuntimeConfiguration`

QueueUrlやaccount IDをIssue、PR、docs、logsへ貼り付けない。Environment secret / deployment configurationとして管理する。

## Runtime接続前の確認

1. Producer roleをAPI workloadへ割り当てる。
2. Consumer roleをWorker workloadへ割り当てる。
3. API / Workerが同じsource queue URLとregionを参照する。
4. API queue typeがstack parameterと一致する。
5. Outboxを有効化する。
6. HTTP producer / consumerのrollback設定を保存する。
7. Productionではなく限定環境から開始する。
8. Send→Receive→claim→terminal保存→DeleteMessageを確認する。
9. Invalid message、consumer停止、visibility expiry、DeleteMessage失敗、DLQ redriveを障害注入する。
10. Learner response / queue eventに内部情報が出ないことを確認する。

## Standard / FIFO変更

`QueueType`変更はqueue replacementとなる。明示QueueNameと`Retain`を使用しているため、同一stackでStandard⇔FIFOを直接切り替えない。

推奨手順:

1. 新しいStack名またはEnvironmentNameで別stackを作成する。
2. New queueへproducer publishを限定環境で開始する。
3. New consumerの処理・ack・DLQを確認する。
4. Old queueのdepth / oldest age / DLQを0まで監視する。
5. Workloadをnew queueへ切り替える。
6. Old queueを隔離し、保持期限と監査要件を確認する。
7. 明示承認後にold retained queueを削除する。

## Rollback

### Runtime rollback

1. `API_QUEUE_TRANSPORT=http`へ戻す。
2. `WORKER_QUEUE_CONSUMER=http`へ戻す。
3. API / Workerを再起動する。
4. HTTP `POST /jobs`とqueued recoveryを確認する。
5. SQS messageは削除せず隔離する。
6. DB lease / stale scanner / attempt fencing / completion guardを維持する。

### CloudFormation update rollback

- Change set未実行: change setを削除する。
- Stack operation失敗: CloudFormation eventとrollback状態を確認する。
- Stack operation成功後に問題発覚: 直前template / parameterで逆change setを作成し、replacement有無を再確認する。
- Queue置換を含むrollback: retained old queueを自動再利用しない。新stackへの段階切替として扱う。

## Stack削除とRetain resource

```bash
aws cloudformation delete-stack \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"
```

Source queueとDLQは`DeletionPolicy=Retain`、`UpdateReplacePolicy=Retain`のためstack削除後も残る。IAM roleとqueue policyはstack削除対象となる。

Retained queueを削除する前に以下を確認する。

- Source queue depthが0である。
- DLQ depthが0、または必要なmessageを承認済み手順で保全した。
- 他workloadがQueueUrl / QueueArnを参照していない。
- 監査・保存期間を満たした。
- Queue削除の明示承認がある。

承認前に`aws sqs delete-queue`を実行しない。

## 障害時確認

```bash
aws cloudformation describe-stack-events \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"
```

確認項目:

- IAM capability不足
- Workload trust principal不正
- Queue名衝突
- Account / region quota
- Organization SCP / permission boundary
- Existing retained queueとの名前衝突
- Standard / FIFO type不一致
- Queue policy適用失敗

Raw credential、token、ReceiptHandle、message body、attempt keyを障害記録へ出さない。
