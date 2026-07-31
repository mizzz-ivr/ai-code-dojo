# Issue #129 Worker retry queue runtime 実装ログ

日付: 2026-07-31

## 背景

PR #128マージ後の次候補としてECS task definition wiringを調査した。現行DBはprocess working directory配下の固定SQLite `.data/app.db`であり、API / Workerを別ECS taskへ配置するとDB共有が成立しない。同一taskへの同居はtask roleが共通になり、API producerとWorker consumer / retry producerのIAM分離を崩す。

このためECS wiringはDB移行・実行トポロジー確定まで保留し、次順位のWorker application retry queue runtime統合を採用した。

## 調査結果

- Application retryは`enqueueSubmissionAttempt`をHTTP self-enqueue設定で呼び出していた。
- Stale recoveryも同じ共通関数をHTTP self-enqueue設定で呼び出していた。
- Worker SQS consumer runtimeはprocess単位でSQS clientを保持していた。
- 既存SQS producerはStandard / FIFOとdedup契約をすでに実装していた。
- Worker CloudFormation roleにはconsume actionだけがあり、retry SendMessage権限がなかった。

## 実装判断

- Worker runtime起動時にprocess-local default producerを登録する。
- Existing application retry / stale recoveryの呼び出し側は変更しない。
- HTTP runtimeはHTTP producerを登録する。
- SQS runtimeはconsumerと同一clientを使うSQS producerを登録する。
- Runtime close時に登録を解除してtest / lifecycleの状態漏れを防ぐ。
- QueueUrl suffixからStandard / FIFOを判定する。
- Worker roleへsource queueのSendMessageだけを追加する。

## 実装内容

- `packages/queue/src/submission-queue.mjs`
  - Default producer registration / restore
  - Effective transport logging
  - Producer生成失敗の一般化event
- `apps/worker/src/config/queue-consumer-config.mjs`
  - QueueUrlからqueue type判定
- `apps/worker/src/services/queue-consumer-runtime.mjs`
  - HTTP / SQS producer登録
  - Consumer / producer client共有
  - `enqueue()` port
  - Close時restore / stop / destroy
- CloudFormation / IAM policy例
  - Worker roleへSendMessage追加
  - CMK例へGenerateDataKey追加
- Static validator / unit test
  - Worker action完全一致
  - SendMessage欠落・権限拡大検知

## セキュリティ確認

- QueueUrl / ReceiptHandle / credentials / raw attempt keyをeventへ追加していない。
- SDK error messageをeventへ追加せず、error typeだけを記録する。
- DLQ read / purge / queue管理 / wildcard resourceを追加していない。
- HTTPを既定値・rollback先として維持した。
- Processing lease / attempt fencing / completion guardを変更していない。

## 初回CI

Draft PR #130のcode headで以下が成功した。

- Lint
- Typecheck
- Unit test
- Integration test
- Schema validation
- Infra validation
- Build

Docs同期後のfinal headで再確認する。

## 管理同期

- GitHub Issue #129: 作成済み
- GitHub PR #130: Draft作成済み
- Notion: 作成済み
- Linear: 無料Issue上限により作成不可
