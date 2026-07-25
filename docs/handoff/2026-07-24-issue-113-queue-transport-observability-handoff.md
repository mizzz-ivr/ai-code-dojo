# Issue #113 queue transport observability handoff

## Summary

現行HTTP queueのenqueue / delivery / claim / heartbeat / application retry / queued startup recovery / stale recoveryを、allowlist fieldのJSON Lines eventとして観測可能にした。

## Current State

- Issue: #113
- PR: #114
- Branch: `feat/queue-transport-observability`
- PR状態: Ready for review / Mergeable
- CI状態: docs validation / lint / typecheck / unit / integration / schema validation / buildがSuccess
- Notion: `https://app.notion.com/p/3a77322f39fa810faa80f87e6a3c6cd3`
- Linear: workspace無料Issue上限により新規mirrorを作成できず、GitHubとRepository docsを正本とする。

## Implemented

- `packages/queue/src/queue-event-logger.mjs`
- queue event name定数
- context field allowlist
- JSON Lines出力
- logger sink failureの非伝播
- HTTP enqueue success / failure / contract rejection event
- Worker delivery accepted / rejected event
- conditional claim success / no-op event
- heartbeat failure event
- application retry event
- queued startup recovery event
- stale recovery candidate / scan event
- queue event logger unit test
- HTTP producer observability unit test
- Worker queue event integration test
- current-status / active-issues / system-overview更新
- queue observability専用runbook
- 作業ログ / AIプロンプトログ / handoff
- PR #114完成版本文・Ready化
- Notion進捗同期

## Event Security Boundary

出力可能:
- timestamp / level / service / event
- transport / source / outcome / generalized reason
- opaque submission ID
- grading attempt / previous attempt / next attempt
- optional correlation ID
- schema version / HTTP status code / rejected field
- scan trigger / aggregate counts
- generalized error type

出力禁止:
- code
- visible / hidden tests詳細
- challenge本文
- secret / token / password
- auth header
- attempt idempotency key
- raw error message
- environment variable値
- internal endpoint詳細

## Invariants

- APIで提出コードを直接実行しない。
- hidden tests詳細をlearnerへ返さない。
- challenge version追加方式を維持する。
- transport retryでgrading attempt / attempt keyを変更しない。
- processing lease / attempt fencing / completion guardを維持する。
- observability失敗を採点correctnessへ伝播しない。
- DB schema / migration / seedを変更しない。
- external queue / backoff / DLQ / metrics backendを混在させない。

## Test Results

最終確認済み:

- docs validation: Success
- lint: Success
- typecheck: Success
- unit test: Success
- integration test: Success
- schema validation: Success
- build: Success

主要確認:

- allowlist fieldだけをJSON Linesへ出力する。
- unknown event / fieldを出力しない。
- code / hidden tests / secret / attempt key / raw error messageを出力しない。
- logger sink failureを業務処理へ伝播しない。
- HTTP 2xx / 非2xx / network error / contract rejectionを分類する。
- Worker delivery accepted / rejectedを記録する。
- missing submissionをclaim no-opとして記録する。
- 既存retry / stale recovery / learner-safe境界を維持する。

## Review Focus

- event nameがstableで過不足ないか。
- allowlistに機微fieldが含まれていないか。
- unknown fieldが確実に除外されるか。
- raw error messageがeventへ出ていないか。
- HTTP producerの2xx / non-2xx / network error分類が妥当か。
- Worker delivery / claimのevent順序が運用上追跡可能か。
- retry / stale recoveryでattempt keyをログへ出していないか。
- logger sink failureが業務処理へ伝播しないか。
- learner-safeレスポンスに変更がないか。
- event volume / retention / internal log access controlが妥当か。

## Remaining Tasks

1. 最終管理同期コミット後のdocs validation / app-qualityを確認する。
2. Issue #113へ実装・テスト結果をコメントする。
3. PR #114をレビュー・mergeする。
4. merge後にIssue #113をCompletedへ同期する。
5. merge後にbranch cleanupを確認する。

## Next Recommended Issue

application retry backoff seamをP1として分離する。

対象候補:
- retry delay policy interface
- exponential backoff
- full jitter
- max delay
- injectable clock / random
- feature flag / configuration validation
- retry storm防止
- structured eventへのdelay field追加可否
- unit / integration test

本Issueへexternal queue、outbox、DLQ ops、metrics backend、dashboard、alert本番設定を混在させない。
