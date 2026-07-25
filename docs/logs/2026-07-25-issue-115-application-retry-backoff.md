# Issue #115 application retry backoff 作業ログ

## Summary

Issue #113 / PR #114のmerge後処理を確認し、次のP1としてapplication retryのnew attempt作成後からHTTP enqueueまでへexponential backoff + full jitterのbest-effort delay seamを実装した。

## Current PR / Issue

- Completed Issue: #113
- Merged PR: #114
- Current Issue: #115
- Current PR: #116
- Branch: `feat/application-retry-backoff`

## Completed Tasks

- PR #114がmerged、Issue #113がClosed / Completedであることを確認した。
- retry backoffに再利用できるopen Issueがないことを確認し、Issue #115を作成した。
- application retry backoff configを追加した。
- exponential cap + full jitterのdelay policyを追加した。
- random / sleepを注入可能にした。
- feature flag無効時は0msとして現行挙動を維持した。
- Workerのnew attempt作成後・enqueue前にdelayを接続した。
- delay wait失敗時はstructured eventを記録して即時enqueueへフォールバックした。
- queue event contractへdelay scheduled / failedとdelay関連fieldを追加した。
- config / policy unit testを追加した。
- Worker実経路のintegration testを追加した。
- current-status / active-issues / system-overviewを更新した。
- application retry backoff専用runbookを追加した。
- Draft PR #116を作成した。

## Technical Decisions

- correctnessを守るため、new attempt / new keyをdelay前にDBへ確定する。
- delay中はqueuedとし、別Workerが先にclaimしても既存fencingで後続deliveryをno-opにする。
- process内delayはdurable schedulingではなくbest-effortとする。
- Worker再起動時queued recoveryがdelayを短絡することをavailability safety netとして許容する。
- first retryはbase delayをcapとし、`retryOrdinal = nextAttempt - 2`とする。
- full jitterは`floor(capDelayMs * random())`とする。
- delay失敗でsubmissionを中間状態へ残さず、即時enqueueへフォールバックする。
- stale recovery enqueueは本Issueの対象外とし、既存挙動を維持する。
- DB schema / migration / seedは変更しない。

## Rejected Alternatives

- delay前に`retry_pending`のまま待機する案
  - Worker停止時にretry_pendingが回収されず停止するため不採用。
- DBへ`next_retry_at`を追加する案
  - durable schedulingとして有効だがschema変更とscanner拡張が必要なため別Issueへ分離。
- stale recoveryにも同じbackoffを同時適用する案
  - 対象範囲と回帰面積が増えるため不採用。
- fixed delay案
  - 同時障害時の再投入集中を十分に分散できないため不採用。

## Risks

- process再起動でdelay予定が失われる。
- queued startup recoveryや別Worker claimによりdelayが短絡する。
- max delayが大きすぎると採点SLOへ影響する。
- feature flagや設定値がWorker間で不一致だとdelay分布が不均一になる。
- application retryの待機中はprocess内Promiseが保持される。
- 現時点ではdurable delayed deliveryとmetrics backendがない。

## Test Results

初回app-qualityではintegration-testのみ失敗した。

- lint: Success
- typecheck: Success
- unit: Success
- schema validation: Success
- integration: Failure

同一headでintegration-testを再実行し成功した。既存integration群と共有SQLiteを使用する一時的競合と判断した。

- integration rerun: Success
- build: 実行確認中
- docs validation: docs反映後の最終headで確認する

## Remaining Tasks

- AIプロンプトログ / handoffを追加する。
- final headのdocs validation / app-qualityを確認する。
- PR #116本文を完成させる。
- PR #116をReady for reviewへ変更する。
- Issue #115へ実装・テスト結果をコメントする。
- Linear / Notion同期可否を確認する。
- merge後にbranch cleanupを確認する。

## Suggested Next Actions

1. PR #116をレビュー・mergeする。
2. external queue / transactional outbox PoCをP2で進める。
3. durable application retry schedulingを別Issueで設計する。
4. Issue #113のeventをmetrics backend / dashboard / alertへ接続する。

## AI Prompts Used

- `docs/ai-prompts/2026-07-25-issue-115-application-retry-backoff-codex.md`

## Handoff

- `docs/handoff/2026-07-25-issue-115-application-retry-backoff-handoff.md`
