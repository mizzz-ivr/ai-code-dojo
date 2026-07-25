# Issue #117 transactional outbox PoC handoff

## Summary
submission作成とqueue publish intentを同一SQLite transactionで保存し、publish失敗時もpending outboxから再送できるPoCを追加した。

## Current State
- Issue: #117
- PR: #118
- Branch: `feat/transactional-outbox-poc`
- PR状態: Draft
- CI状態: 初回app-quality全成功、docs反映後のfinal head確認待ち

## Implemented
- `queue_outbox` table
- pending検索index
- `(submission_id, grading_attempt)` unique constraint
- submission + outbox atomic transaction
- outbox insert失敗時のrollback
- outbox feature flag / interval / batch size config
- API startup / submission / interval dispatcher
- existing HTTP queue producerへのpublish
- publish成功時のpublished更新
- publish失敗時のpending維持
- publish attempt / last attempted time / generalized error type
- outbox publish / dispatch event
- dispatcherのunexpected error containment
- migration / unit / integration test
- current-status / active-issues / system-overview
- transactional outbox runbook
- 作業ログ / AIプロンプトログ / handoff

## Configuration
- `API_QUEUE_OUTBOX_ENABLED`（既定false）
- `API_QUEUE_OUTBOX_POLL_INTERVAL_MS`（既定1000ms）
- `API_QUEUE_OUTBOX_BATCH_SIZE`（既定25）

## Data Model
`queue_outbox`:
- `id`
- `submission_id`
- `grading_attempt`
- `message_json`
- `status`
- `created_at`
- `updated_at`
- `published_at`
- `publish_attempts`
- `last_attempted_at`
- `last_error_type`

`message_json`はqueue message contractだけを保持する。code / visible tests / hidden tests / secretを含めない。

## Transaction Boundary
```text
BEGIN IMMEDIATE
  INSERT submissions(status=queued)
  INSERT queue_outbox(status=pending)
COMMIT
```

outbox insertを含む途中失敗時はROLLBACKする。

## API Semantics
### outbox disabled
```text
save submission
  -> synchronous HTTP enqueue
  -> success: 201
  -> failure: 502
```

### outbox enabled
```text
atomic save submission + outbox
  -> success: 201
  -> best-effort immediate dispatch
  -> periodic retry while pending
```

publish失敗をlearner-facing 502へ変換しない。outbox情報をresponseへ追加しない。

## Correctness Boundary
- outboxはpublish intent durabilityを担当する。
- publishはat-least-onceでありduplicateを許容する。
- outbox published更新失敗時はpendingを維持する。
- Worker conditional claim / attempt fencing / processing lease / completion guardが採点correctnessを担当する。
- exactly-once publishへ依存しない。
- transport publishでgrading attempt / attempt keyを変更しない。
- stale recovery / Worker application retry enqueueは本Issueでoutbox経由へ変更しない。

## Observability
追加event:
- `queue.outbox.publish_succeeded`
- `queue.outbox.publish_failed`
- `queue.outbox.dispatch_completed`
- `queue.outbox.dispatch_failed`

出力禁止:
- code
- visible / hidden tests詳細
- secret / token / password
- attempt idempotency key
- raw error message
- environment variable値

## Test State
初回head:
- lint: Success
- typecheck: Success
- unit: Success
- integration: Success
- schema validation: Success
- build: Success

追加実装・docs反映後にfinal headを再確認する。

## Review Focus
- submission + outboxが同一transactionでcommit / rollbackされるか。
- outbox無効時にlegacy 502挙動を維持するか。
- outbox有効時の201受理条件が妥当か。
- publish成功時だけpublishedへ更新するか。
- 状態更新失敗でpendingが安全に残るか。
- duplicate publishを既存DB fencingで吸収できるか。
- message / event / responseへ機微情報が混入していないか。
- API startup / interval dispatcherが未処理Promiseを発生させないか。
- migrationがlegacy DBで冪等か。
- stale recovery / application retryへ不要な変更がないか。

## Risks
- current HTTP 202はdurable broker ackではない。
- multi-process outbox claim / leaseは未実装。
- multiple API processes can publish the same pending row.
- pending監視・retention・purgeは未実装。
- feature flag有効時はpublish障害でも201となるため運用監視が必須。
- SQLite multi-host共有は非対応。

## Remaining Tasks
1. final headのdocs validation / app-qualityを確認する。
2. PR #118本文を完成させる。
3. PR #118をReady for reviewへ変更する。
4. Issue #117へ実装・テスト結果をコメントする。
5. Linear / Notion同期可否を確認する。
6. merge後にbranch cleanupを確認する。

## Next Recommended Issue
- external queue producer adapter / broker PoC
- DLQ ops / replay / purge
- outbox pending metrics / alert
- outbox claim / lease for multi-process API
- durable application retry scheduling

本Issueへ実broker、DLQ、metrics backend、Runner、hidden tests、auth、UI、deployment変更を混在させない。
