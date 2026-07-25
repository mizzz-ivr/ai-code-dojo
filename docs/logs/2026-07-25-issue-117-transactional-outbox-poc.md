# Issue #117 transactional outbox PoC 作業ログ

## Summary
PR #116のmergeとIssue #115の完了を確認し、次のP2としてsubmission保存とqueue publish intentを同一SQLite transactionで確定するtransactional outbox PoCを実装した。

## Current Issue / PR
- Issue: #117
- PR: #118
- Branch: `feat/transactional-outbox-poc`
- PR状態: Draft

## Completed Tasks
- PR #116がmerged、Issue #115がClosed / Completedであることを確認した。
- outbox / external queue関連のopen Issueがないことを確認し、Issue #117を作成した。
- `queue_outbox` tableとpending検索indexを追加した。
- `(submission_id, grading_attempt)` unique constraintを追加した。
- submission + outbox atomic transaction repositoryを追加した。
- transaction途中のoutbox insert失敗時にsubmissionもrollbackするよう実装した。
- outbox feature flag / poll interval / batch size configを追加した。
- pending outbox dispatcherを追加した。
- API起動時・submission直後・interval dispatchを追加した。
- publish成功時だけpublishedへ更新するよう実装した。
- publish失敗時はpendingを維持し、attempt count / last attempted time / generalized error typeを更新するよう実装した。
- outbox publish / dispatch eventを追加した。
- dispatcherの予期しないDB更新例外を外へ漏らさずpending維持するよう補強した。
- migration / config / atomic transaction / dispatcher / service / integration testを追加した。
- current-status / active-issues / system-overviewを更新した。
- transactional outbox運用runbookを追加した。
- Draft PR #118を作成した。

## Technical Decisions
- outbox feature flag無効時はlegacyのsubmission保存→同期HTTP enqueueと502挙動を維持する。
- outbox有効時はatomic DB保存成功をAPI受理条件とし、publish失敗でも201を返す。
- outbox messageはqueue message contractだけを保存し、code / testsを保存しない。
- current publish先は既存HTTP queue producerとし、実broker導入を別Issueへ分離する。
- outboxはdelivery intent durabilityを担当し、採点correctnessはWorker DB fencingへ依存する。
- at-least-once publishを前提とし、duplicate publishを許容する。
- published更新失敗時はpendingを維持し、次回publishを許容する。
- multi-process claim / leaseはPoC対象外とする。
- stale recovery / Worker retryのenqueueは本Issueでoutbox経由へ変更しない。

## Rejected Alternatives
- submission保存後にoutbox rowを別transactionで作る案
  - dual-write問題が残るため不採用。
- API request内でpublish成功を201条件にする案
  - outbox導入目的と矛盾し、publish障害時にdurable intentを活用できないため不採用。
- 同時にSQS adapterを導入する案
  - 製品依存・deployment・認証・ack責務が混在するため別Issueへ分離。
- exactly-once publishを保証する案
  - 現行HTTP transportと将来brokerの障害モデルに対して現実的でなく、既存DB fencingを活用する方針を維持。
- outbox rowへ提出コードを保存する案
  - queue message contractとセキュリティ境界に反するため不採用。

## Risks
- 現行HTTP 202はdurable broker ackではない。
- 複数API processでは同じpending rowを重複publishし得る。
- published更新失敗後は次回dispatchでduplicate publishする。
- polling間隔やbatch sizeが不適切だとAPI / DB負荷へ影響する。
- outbox有効時はpublish障害でも201となるため、pending監視が必要。
- pending retention / purgeが未実装。
- SQLiteを複数ホストで共有する運用は非対応。

## Test Results
初回headで以下が成功した。

- lint: Success
- typecheck: Success
- unit: Success
- integration: Success
- schema validation: Success
- build: Success

追加のdispatcher例外処理とdocs反映後、final headで再確認する。

## Remaining Tasks
- AIプロンプトログ / handoffを追加する。
- final headのdocs validation / app-qualityを確認する。
- PR #118本文を完成させる。
- PR #118をReady for reviewへ変更する。
- Issue #117へ実装・テスト結果をコメントする。
- Linear / Notion同期可否を確認する。
- merge後にbranch cleanupを確認する。

## Suggested Next Actions
1. PR #118をレビュー・mergeする。
2. outbox dispatcher配下へexternal queue producer adapter PoCを追加する。
3. DLQ ops / replay / purgeを設計する。
4. pending count / oldest ageをmetrics backendへ接続する。

## AI Prompts Used
- `docs/ai-prompts/2026-07-25-issue-117-transactional-outbox-poc-codex.md`

## Handoff
- `docs/handoff/2026-07-25-issue-117-transactional-outbox-poc-handoff.md`
