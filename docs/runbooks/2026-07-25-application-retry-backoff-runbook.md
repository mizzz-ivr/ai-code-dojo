# application retry backoff runbook

最終更新: 2026-07-25（Issue #115 / PR #116）

## 目的

infrastructure failure後のapplication retryをexponential backoff + full jitterで分散し、Worker・Runner・依存サービスへの同時再投入を抑制する。

## 適用範囲

- Workerのinfrastructure failure retry
- `running -> retry_pending -> queued(new attempt)` 後のHTTP enqueue
- process内best-effort delay
- queue structured eventによる確認

対象外:

- transport retry
- stale recovery enqueue
- durable delayed delivery
- external queue / transactional outbox
- DLQ replay
- learner向け表示変更

## 設定値

| 環境変数 | 既定値 | 説明 |
|---|---:|---|
| `WORKER_APPLICATION_RETRY_BACKOFF_ENABLED` | `0` | `1`で有効化 |
| `WORKER_APPLICATION_RETRY_BASE_DELAY_MS` | `5000` | 初回retryのdelay上限 |
| `WORKER_APPLICATION_RETRY_MAX_DELAY_MS` | `60000` | exponential capの最大値 |
| `WORKER_MAX_INFRA_RETRY_ATTEMPTS` | `2` | 既存のapplication retry上限 |

validation:

- base / max delayは正の整数。
- max delayはbase delay以上。
- 不正設定はWorker起動時にエラーとする。
- feature flag無効時も設定値自体はvalidationする。

## delay計算

```text
retryOrdinal = nextAttempt - 2
capDelayMs = min(maxDelayMs, baseDelayMs * 2^retryOrdinal)
delayMs = floor(capDelayMs * random())
```

`random()`は0以上1未満とする。

例:

| next attempt | retry ordinal | base 5000ms時のcap |
|---:|---:|---:|
| 2 | 0 | 5000ms |
| 3 | 1 | 10000ms |
| 4 | 2 | 20000ms |
| 5 | 3 | 40000ms |
| 6以降 | 4以上 | max 60000ms |

full jitterにより、実delayは0ms以上cap未満となる。

## 状態遷移

```text
running(attempt=N)
  -> retry_pending(attempt=N)
  -> queued(attempt=N+1, new key)
  -> delay
  -> HTTP enqueue
```

重要:

- new attempt / new keyはdelay前にDBへ確定する。
- delay中のstatusは`queued`。
- delay失敗時は即時enqueueへフォールバックする。
- enqueue失敗時は既存のqueued attempt専用fenced終端化で`infra_failed`へ確定する。
- retry上限、attempt fencing、completion guardは変更しない。

## best-effort境界

process内delayはdurable schedulingではない。

以下の場合、予定delayより早く処理される可能性がある。

- Worker再起動時のqueued recovery
- 別Workerが同じqueued attemptを先にclaim
- 運用上の手動redelivery

その場合もDB conditional claim、attempt fencing、completion guardにより二重採点・旧attempt更新を防止する。

厳密な実行時刻保証が必要な場合は、external queueのdelayed deliveryまたはDBに永続化した`next_retry_at`を別Issueで設計する。

## 構造化event

### delay予定

`queue.retry.delay_scheduled`

主なfield:

- submission ID
- previous / next attempt
- retry ordinal
- delay ms
- cap delay ms
- backoff enabled
- outcome（`scheduled` / `immediate`）

### delay失敗

`queue.retry.delay_failed`

主なfield:

- submission ID
- grading attempt
- retry ordinal
- delay ms
- backoff enabled
- outcome=`fallback_immediate`
- reason=`delay_wait_failed`
- generalized error type

記録禁止:

- code
- visible / hidden tests詳細
- secret / token / password
- attempt idempotency key
- raw error message
- environment variable値

## ロールアウト

1. feature flag無効のまま新Workerをdeployする。
2. 通常採点、infrastructure retry、stale recoveryの回帰を確認する。
3. 限定環境でbase 5000ms / max 60000msとして有効化する。
4. `delay_scheduled`、`retry.enqueue_succeeded`、`retry.terminalized`の順序を確認する。
5. retry storm、採点待ち時間、infra_failed率、Worker負荷を確認する。
6. 必要に応じてbase / maxを調整する。
7. 全環境有効化は平常時データ確認後に行う。

## ロールバック

- `WORKER_APPLICATION_RETRY_BACKOFF_ENABLED=0`としてWorkerを再起動する。
- code revertは不要で、delay 0msの従来挙動へ戻る。
- DB migration rollbackは不要。
- queued attempt、attempt fencing、completion guard、stale scannerは維持する。

## 障害時確認

### retryが遅すぎる

1. base / max delay設定を確認する。
2. `queue.retry.delay_scheduled`のdelay / cap / ordinalを確認する。
3. retry ordinalが想定attemptと一致するか確認する。
4. 採点SLOを超える場合はbase / maxを縮小する。
5. 緊急時はfeature flagを無効化する。

### delay event後にenqueue eventがない

1. Worker processの再起動・停止を確認する。
2. `queue.retry.delay_failed`を確認する。
3. DB上のsubmissionがqueuedか、別Workerにclaim済みか確認する。
4. queuedならWorker起動時回収を優先する。
5. terminal済み・old attemptなら再投入しない。

### retry stormが続く

1. feature flagが全Workerで有効か確認する。
2. full jitterのdelay分布を確認する。
3. Worker再起動が頻発しqueued recoveryでdelayを短絡していないか確認する。
4. infrastructure failure原因を復旧する。
5. durable schedulingが必要ならexternal queue / next_retry_at Issueへエスカレーションする。

## テスト観点

- feature flag無効でdelay 0ms。
- 初回retryのcapがbase delay。
- retry ordinalに応じてcapが指数増加。
- max delayでcapする。
- deterministic randomでdelayを再現できる。
- injected sleepへ算出値だけを渡す。
- 不正config / random / delayを拒否する。
- Worker実経路でdelay eventを記録する。
- retry後に既存`infra_failed`終端経路へ到達する。
- learner-safeレスポンスへdelay・attempt key・内部eventを追加しない。

## 参照

- Issue #115: `https://github.com/mizzz-ivr/ai-code-dojo/issues/115`
- PR #116: `https://github.com/mizzz-ivr/ai-code-dojo/pull/116`
- queue運用設計: `docs/reports/2026-07-23-queue-operations-visibility-dlq-backoff-design.md`
- queue observability: `docs/runbooks/2026-07-24-queue-transport-observability-runbook.md`
- Worker障害復旧: `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
