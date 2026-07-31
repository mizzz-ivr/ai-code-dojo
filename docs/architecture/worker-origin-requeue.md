# Worker-origin requeue architecture

最終更新: 2026-07-31

## 目的

Workerが生成するapplication retryとstale recoveryを、選択中のHTTP / SQS queue runtimeへ一貫して再投入する設計境界を定義する。

## コンポーネント

- `enqueueSubmissionAttempt`: version付きqueue messageを構築する共通入口
- Default producer registration: Worker processの選択runtimeを共通入口へ接続するprocess-local registration
- HTTP producer: Worker `POST /jobs`へmessageを送信するrollback経路
- SQS producer: Source queueへSendMessageするAWS経路
- SQS consumer: Source queueをlong pollingし、DB永続状態確認後にackする
- Application retry: Infrastructure failure後にnew attemptを作成して再投入する
- Stale recovery: Processing lease期限切れのrunning submissionをnew attemptへ回収して再投入する

## 初期化順序

1. Workerがqueue consumer configを読み込む。
2. HTTP / SQS runtimeを作成する。
3. Runtimeが選択transportのproducer factoryをprocess-local defaultとして登録する。
4. Application retry / stale recoveryは既存の`enqueueSubmissionAttempt`を呼び出す。
5. 共通入口が登録済みproducerへmessageを渡す。
6. Worker shutdown時にregistrationをrestoreする。
7. SQSの場合はpoll停止後にclientをdestroyする。

## HTTP経路

```text
application retry / stale recovery
  -> enqueueSubmissionAttempt
  -> HTTP producer
  -> POST /jobs
  -> common message parser
  -> processSubmission
```

- AWS clientを生成しない。
- 既存の運用・rollback互換を維持する。

## SQS経路

```text
application retry / stale recovery
  -> enqueueSubmissionAttempt
  -> SQS producer
  -> source queue
  -> shared SQS client consumer
  -> common message parser
  -> processSubmission
```

- Producer / consumerはWorker process内で1つのSQS clientを共有する。
- QueueUrl / region / queue typeはconsumer configを正本とする。
- Standard / FIFOでmessage contractを変更しない。
- FIFO metadataは既存SQS producerが生成する。

## Retry state boundary

Application retry:

1. Current attemptを`retry_pending`へ条件付き更新する。
2. New grading attempt / idempotency keyを作成する。
3. Backoff後に選択runtimeへenqueueする。
4. 成功時だけretry処理完了とする。
5. 失敗時はnew attemptを`infra_failed`へ条件付き終端化する。

Stale recovery:

1. Lease期限切れcandidateを取得する。
2. Old attempt / key / lease expiryを条件にnew attemptへ回収する。
3. 選択runtimeへenqueueする。
4. 失敗時はnew attemptを`infra_failed`へ条件付き終端化する。

## Correctness

- Queue transportはdelivery availabilityを担う。
- DB processing leaseはcurrent attemptの実行所有権を担う。
- Attempt idempotency keyはattempt fencingを担う。
- Completion guardはterminal保存の一意化を担う。
- Queue retry / duplicate deliveryでattempt / keyを変更しない。
- Exactly-once publish / deliveryへ依存しない。

## IAM boundary

API producer role:

- Source queueの`sqs:SendMessage`だけ。

Worker role:

- Source queueの`sqs:ReceiveMessage`
- Source queueの`sqs:DeleteMessage`
- Source queueの`sqs:ChangeMessageVisibility`
- Source queueの`sqs:SendMessage`

Workerがretry producerを兼ねるためSendMessageが必要になるが、resourceは同じsource queueだけに限定する。

## Security boundary

Queue messageへ含めないもの:

- 提出コード
- Visible / hidden tests
- Credentials / secret
- QueueUrl / ReceiptHandle
- Raw SDK error
- Learnerへ不要なinternal state

Eventへraw attempt keyを記録しない。Send failureは一般化reasonとerror typeだけを記録する。

## ECS deployment blocker

現行は固定SQLite `.data/app.db`を使用する。

- API / Workerを別ECS taskへ分離するとDB fileを共有できない。
- API / Workerを同一taskへ同居させるとtask roleが共通になりIAM分離を維持できない。
- Managed DB移行または実行トポロジー確定前にECS wiringを実装しない。

## 参照

- Issue #129
- PR #130
- `docs/runbooks/2026-07-31-worker-retry-queue-runtime-runbook.md`
- `packages/queue/src/submission-queue.mjs`
- `apps/worker/src/services/queue-consumer-runtime.mjs`
