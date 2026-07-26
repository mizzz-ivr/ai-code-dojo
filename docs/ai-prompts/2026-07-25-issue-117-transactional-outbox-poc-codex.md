# Issue #117 transactional outbox PoC 実装プロンプト

あなたはこのRepositoryのシニアバックエンドエンジニア兼レビュアーです。

## 最優先
最初に `docs/ai-protocol/PROMPT.txt` を読み、正本docsと不変条件を確認してください。

## 対象
- Repository: `mizzz-ivr/ai-code-dojo`
- Issue: #117
- Branch: `feat/transactional-outbox-poc`
- PR / commit / comments / docsは日本語
- branch名へ`codex`を含めない

## 目的
submission保存とqueue publish intent登録を同一SQLite transactionで確定し、publish失敗時もpending outboxから再送可能にしてください。

## 必須要件
1. `queue_outbox` tableを追加する。
2. `(submission_id, grading_attempt)`を一意にする。
3. pending検索用indexを追加する。
4. submission rowとoutbox rowを`BEGIN IMMEDIATE` transaction内で作成する。
5. outbox insert失敗時はsubmissionもrollbackする。
6. `API_QUEUE_OUTBOX_ENABLED`でlegacy / outbox経路を切り替える。
7. poll interval / batch sizeを正のsafe integerとして検証する。
8. outbox無効時は既存の同期HTTP enqueueと502挙動を維持する。
9. outbox有効時はatomic保存成功を201条件とし、publish失敗を502へ変換しない。
10. API起動時・submission直後・intervalでpending dispatcherを実行する。
11. dispatcherは既存`enqueueSubmissionAttempt`を利用する。
12. publish成功時だけpublishedへ更新する。
13. publish失敗時はpendingを維持し、attempt count / last attempted time / generalized error typeを更新する。
14. duplicate publishを許容し、Worker conditional claim / attempt fencing / completion guardを維持する。
15. event / responseへcode / tests / secret / attempt key / raw error messageを出さない。
16. learner responseへoutbox情報を追加しない。
17. migration / unit / integration testを追加する。
18. current-status / active-issues / system-overview / runbook / logs / ai-prompts / handoffを更新する。

## 非対象
- SQS / RabbitMQ / Redis Streams等の実broker
- broker製品選定の最終決定
- ack / nack / visibility timeout
- DLQ / replay / purge
- outbox UI / admin API
- PostgreSQL移行
- durable application retry scheduling
- Runner / hidden tests / auth / admin / learner UI / deployment変更
- 無関係なリファクタリング

## 正しさの境界
- outboxはdelivery intent durabilityを担う。
- 採点correctnessはDB conditional claim / processing lease / attempt fencing / completion guardが担う。
- exactly-once publishを前提にしない。
- publish成功後のoutbox更新失敗ではpendingを維持し、duplicate publishを許容する。
- transport publishでgrading attempt / attempt keyを変更しない。
- stale recoveryとWorker application retryのenqueue経路は本Issueで変更しない。

## セキュリティ
- APIで提出コードを直接実行しない。
- hidden tests詳細をlearner・Issue・PR・docs・logsへ出さない。
- outbox messageへqueue contract以外のデータを保存しない。
- eventへ環境変数値やraw error messageを出さない。
- `.data/app.db`をcommitしない。

## テスト観点
### 正常系
- migrationが冪等である。
- submission + outboxが同時commitされる。
- pending messageがpublishされpublishedへ更新される。
- Workerが通常どおり採点しterminalへ到達する。

### 異常系
- outbox insert失敗でsubmissionもrollbackされる。
- Worker不在でもoutbox有効時は201で受理する。
- enqueue失敗でpendingを維持する。
- outbox状態更新失敗でdispatcherが未処理例外を出さない。
- invalid messageを一般化error typeで記録する。

### 境界値
- feature flag false / true。
- poll interval / batch sizeの0、小数、非数値。
- batch size 1。
- duplicate publish。
- published更新no-op。

### 回帰
- legacy outbox無効時の502。
- learner-safe response。
- application retry / stale recovery。
- queue message contract。
- hidden tests非漏洩。

## 品質ゲート
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm schema:validate`
- `pnpm build`
- docs validation

## PR
### タイトル
submission作成とqueue publishをtransactional outboxで一貫化する

### 本文に含める内容
- 目的 / 背景
- schemaとtransaction境界
- legacy / outbox API semantics
- dispatcherとat-least-once
- correctness / security境界
- 影響範囲
- テスト結果
- rollout / rollback
- レビュー観点
- 未対応事項
