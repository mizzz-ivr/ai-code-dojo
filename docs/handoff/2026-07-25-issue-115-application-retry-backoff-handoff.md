# Issue #115 application retry backoff handoff

## Summary

application retryのnew attempt作成後からHTTP enqueueまでへ、feature flag付きexponential backoff + full jitterのbest-effort delay seamを追加した。

## Current State

- Issue: #115
- PR: #116
- Branch: `feat/application-retry-backoff`
- PR状態: Draft
- CI状態: docs反映後の最終head確認中

## Implemented

- `apps/worker/src/config/application-retry-backoff-config.mjs`
- `apps/worker/src/services/application-retry-backoff.mjs`
- feature flag / base delay / max delay validation
- retry ordinalに基づくexponential cap
- full jitter
- injectable random / sleep
- Worker retry経路へのdelay接続
- delay wait失敗時の即時enqueue fallback
- `queue.retry.delay_scheduled`
- `queue.retry.delay_failed`
- delay関連field allowlist
- config / policy unit test
- Worker実経路integration test
- current-status / active-issues / system-overview更新
- application retry backoff runbook
- 作業ログ / AIプロンプトログ / handoff

## Configuration

- `WORKER_APPLICATION_RETRY_BACKOFF_ENABLED`
- `WORKER_APPLICATION_RETRY_BASE_DELAY_MS`（既定5000ms）
- `WORKER_APPLICATION_RETRY_MAX_DELAY_MS`（既定60000ms）

## Delay Formula

```text
retryOrdinal = nextAttempt - 2
capDelayMs = min(maxDelayMs, baseDelayMs * 2^retryOrdinal)
delayMs = floor(capDelayMs * random())
```

## Correctness Boundary

- new attempt / new keyはdelay前にDBへ確定する。
- delay中のstatusはqueued。
- 別Workerやstartup queued recoveryが先にclaimしても後続deliveryはno-opとなる。
- process内delayはdurable schedulingではない。
- retry上限、processing lease、attempt fencing、completion guardを維持する。
- delay失敗時は即時enqueueへフォールバックする。
- stale recovery enqueueは本Issueのbackoff対象外。

## Security Boundary

出力可能:

- submission ID
- previous / next attempt
- retry ordinal
- delay / cap delay
- backoff enabled
- generalized outcome / reason / error type

出力禁止:

- code
- visible / hidden tests詳細
- secret / token / password
- attempt idempotency key
- raw error message
- environment variable値

## Test State

初回app-quality:

- lint: Success
- typecheck: Success
- unit: Success
- schema validation: Success
- integration: Failure

同一headでintegrationを再実行しSuccess。共有SQLiteを利用するintegration群の一時的競合と判断した。

最終docs反映後に以下を再確認する。

- docs validation
- lint
- typecheck
- unit
- integration
- schema validation
- build

## Review Focus

- retry ordinalとcap計算が既存attempt semanticsと一致するか。
- feature flag無効時に現行即時enqueueを維持するか。
- new attempt作成後にdelayする判断がcorrectness上安全か。
- Worker再起動でdelayが短絡するbest-effort境界が許容できるか。
- delay wait失敗時の即時fallbackが妥当か。
- event allowlistへ機微情報が混入していないか。
- stale recoveryへ不要なbackoffが混在していないか。
- DB schema / migration / seed変更がないか。

## Remaining Tasks

1. final headのdocs validation / app-qualityを確認する。
2. 作業ログ / handoffへ最終CI結果を確定する。
3. PR #116本文を完成させる。
4. PR #116をReady for reviewへ変更する。
5. Issue #115へ実装・テスト結果をコメントする。
6. Linear / Notion同期可否を確認する。
7. merge後にbranch cleanupを確認する。

## Next Recommended Issue

- external queue / transactional outbox PoC
- durable application retry scheduling
- DLQ ops / replay / purge
- queue metrics backend / dashboard / alert接続

本Issueへtransport retry、external queue、outbox、DLQ ops、metrics backend、Runner変更を混在させない。
