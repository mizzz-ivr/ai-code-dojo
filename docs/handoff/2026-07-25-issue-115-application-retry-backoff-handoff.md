# Issue #115 application retry backoff handoff

## Summary

application retryのnew attempt作成後からHTTP enqueueまでへ、feature flag付きexponential backoff + full jitterのbest-effort delay seamを追加した。

## Current State

- Issue: #115
- PR: #116
- Branch: `feat/application-retry-backoff`
- PR状態: Draft（Ready化前）
- CI状態: docs validation / app-quality 全成功

## Implemented

- application retry backoff設定と起動時validation
- retry ordinalに基づくexponential cap
- full jitter
- injectable random / sleep
- Worker retry経路へのdelay接続
- delay wait失敗時の即時enqueue fallback
- `queue.retry.delay_scheduled`
- `queue.retry.delay_failed`
- delay関連field allowlist
- config / policy unit test
- 決定的なintegration test
- 既存API retry / terminal回帰テスト維持
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

## Event Boundary

記録可能:

- submission ID
- previous / next attempt
- retry ordinal
- delay / cap delay
- backoff enabled
- generalized outcome / reason / error type

記録しない:

- submitted source
- test details
- credentials
- attempt idempotency key
- raw error message
- environment variable values

## Test State

最終headで以下が成功している。

- docs validation
- lint
- typecheck
- unit test
- integration test
- schema validation
- build

### Integration test改善

初期のprocess integration testは複数テストが同一SQLiteを利用するため、別Workerによるqueued row claimで不安定になった。

修正後はprocess / shared DB依存を除去し、config、delay policy、queue event logger、injected sleepを統合した決定的テストで次を確認する。

- event → sleep → enqueueの順序
- delay計算
- event field制限
- wait失敗時の即時fallback

serverのretry状態遷移と`infra_failed`終端は既存`api-flow`で継続確認する。

## Review Focus

- retry ordinalとcap計算
- feature flag無効時の即時enqueue
- new attempt作成後にdelayするcorrectness
- Worker再起動でdelayが短絡するbest-effort境界
- delay wait失敗時のfallback
- event field制限
- stale recoveryへの非適用
- DB schema変更がないこと
- integration testが共有SQLiteへ依存しないこと

## Remaining Tasks

1. PR #116本文を完成させる。
2. PR #116をReady for reviewへ変更する。
3. active-issues / handoffのPR状態をReadyへ同期する。
4. Issue #115へ実装・テスト結果をコメントする。
5. Linear / Notion同期可否を確認する。
6. merge後にbranch cleanupを確認する。

## Next Recommended Issue

- external queue / transactional outbox PoC
- durable application retry scheduling
- DLQ ops / replay / purge
- queue metrics backend / dashboard / alert接続
