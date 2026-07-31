# Issue #129 Worker retry queue runtime 実装ログ

日付: 2026-07-31

## 背景

PR #128マージ後の次候補としてECS task definition wiringを調査した。現行DBはprocess working directory配下の固定SQLite `.data/app.db`であり、API / Workerを別ECS taskへ配置するとDB共有が成立しない。同一taskへの同居はtask roleが共通になり、API producerとWorker consumer / retry producerのIAM分離を崩す。

このためECS wiringはDB移行・実行トポロジー確定まで保留し、次順位のWorker application retry queue runtime統合を採用した。

## 調査結果

- Application retryは`enqueueSubmissionAttempt`をHTTP self-enqueue設定で呼び出していた。
- Stale recoveryも同じ共通関数をHTTP self-enqueue設定で呼び出していた。
- Worker SQS consumer runtimeはprocess単位でSQS clientを保持していた。
- 既存SQS producerはStandard / FIFOとdedup契約を実装済みだった。
- Worker CloudFormation roleにはconsume actionだけがあり、retry SendMessage権限がなかった。

## 実装判断

- Worker runtimeへtransport共通の`enqueue()` portを追加する。
- Application retryはserverからruntime `enqueue()`を直接呼ぶ。
- Stale recoveryはscannerへ`enqueueAttempt`としてruntime `enqueue()`を明示注入する。
- Process-global producer registrationや共有可変singletonを使用しない。
- HTTP runtimeは既存HTTP producerを保持する。
- SQS runtimeはconsumerと同一clientを使うSQS producerを保持する。
- QueueUrl suffixからStandard / FIFOを判定する。
- Worker roleへsource queueのSendMessageだけを追加する。

## 実装内容

- `apps/worker/src/server.mjs`
  - Application retryへruntime `enqueue()`を明示接続
  - Stale scannerへruntime `enqueue()`を注入
- `apps/worker/src/services/stale-recovery-scanner.mjs`
  - `enqueueAttempt` dependencyを追加
- `apps/worker/src/config/queue-consumer-config.mjs`
  - QueueUrlからqueue type判定
- `apps/worker/src/services/queue-consumer-runtime.mjs`
  - HTTP / SQS producer保持
  - Consumer / producer client共有
  - `enqueue()` port
  - Close時stop / single destroy
- CloudFormation / IAM policy例
  - Worker roleへSendMessage追加
  - CMK例へGenerateDataKey追加
- Static validator / unit test
  - Worker action完全一致
  - SendMessage欠落・権限拡大検知
  - Stale recoveryが注入されたruntime enqueueを使用することを検証

## セキュリティ確認

- QueueUrl / ReceiptHandle / credentials / raw attempt keyをeventへ追加していない。
- SDK error messageをeventへ追加せず、error typeだけを記録する。
- DLQ read / purge / queue管理 / wildcard resourceを追加していない。
- HTTPを既定値・rollback先として維持した。
- Processing lease / attempt fencing / completion guardを変更していない。
- Process-global mutable stateを除去した。

## CI

依存注入後のcode headで以下が成功した。

- Lint
- Typecheck
- Unit test
- Integration test
- Schema validation
- Infra validation

Docs同期後のfinal headでBuildを含む全品質ゲートを再確認する。

## 管理同期

- GitHub Issue #129: 作成済み
- GitHub PR #130: Draft作成済み
- Notion: 作成済み
- Linear: 無料Issue上限により作成不可
