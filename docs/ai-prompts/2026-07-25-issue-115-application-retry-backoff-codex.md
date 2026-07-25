# Issue #115 application retry backoff Codex prompt

## 依頼

GitHub Issue #115を実装してください。

## 最優先ルール

最初に `docs/ai-protocol/PROMPT.txt` を読み、Repositoryのcanonical rulesとして厳守してください。

## 目的

既存のinfrastructure failure retryへ、設定可能なexponential backoff + full jitterのdelay seamを追加してください。

## 必須要件

- `WORKER_APPLICATION_RETRY_BACKOFF_ENABLED`を追加する。
- `WORKER_APPLICATION_RETRY_BASE_DELAY_MS`を追加する。
- `WORKER_APPLICATION_RETRY_MAX_DELAY_MS`を追加する。
- base / maxは正の整数としてvalidationする。
- maxがbase未満ならWorker起動時に失敗させる。
- feature flag無効時はdelay 0msで現行挙動を維持する。
- `retryOrdinal = nextAttempt - 2`とする。
- `capDelayMs = min(maxDelayMs, baseDelayMs * 2^retryOrdinal)`とする。
- `delayMs = floor(capDelayMs * random())`のfull jitterとする。
- random / sleepを注入可能にする。
- new attempt / new key作成後、HTTP enqueue前にdelayする。
- delay wait失敗時は一般化eventを記録し、即時enqueueへフォールバックする。
- `queue.retry.delay_scheduled` / `queue.retry.delay_failed`を追加する。
- eventへdelayMs / capDelayMs / retryOrdinal / backoffEnabledを記録可能にする。
- code / hidden tests / secret / attempt key / raw error messageをeventへ出さない。
- retry上限、processing lease、attempt fencing、completion guardを変更しない。
- stale recovery enqueueへbackoffを混在させない。
- DB schema / migration / seedを変更しない。

## best-effort境界

- delay中のsubmissionはqueuedとする。
- 別WorkerまたはWorker再起動時queued recoveryが先にclaimしても、既存conditional claim / attempt fencingで後続deliveryをno-opにする。
- process内delayはdurable schedulingではないことをdocsへ明記する。
- durable schedulingはexternal queue delayed deliveryまたは永続化`next_retry_at`の別Issueとする。

## テスト

最低限、次を追加・確認してください。

- feature flag無効時は0ms。
- 初回retry capはbase delay。
- retry ordinalに応じて指数増加する。
- max delayでcapする。
- deterministic randomでdelayを再現できる。
- injected sleepへ算出値を渡す。
- 不正config / random / delayを拒否する。
- Worker実経路でdelay eventを記録する。
- eventへattempt key / code / hidden testsを出さない。
- retry後に既存infra_failed終端経路へ到達する。
- learner-safe境界を維持する。
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm schema:validate`
- `pnpm build`
- docs validation

## docs

次を更新してください。

- `docs/current-status.md`
- `docs/active-issues.md`
- `docs/architecture/system-overview.md`
- application retry backoff runbook
- 作業ログ
- AIプロンプトログ
- handoff

## 非対象

- transport retry backoff
- external queue / transactional outbox
- durable delayed delivery
- visibility timeout / ack / nack / DLQ
- metrics backend / dashboard / 本番alert設定
- Runner / hidden tests / auth / admin / UI / deployment変更
- challenge直接上書き
- 無関係なリファクタリング

## PRルール

- PRタイトル・本文・commit messageは日本語。
- branch名に`codex`を含めない。
- 差分はIssue #115に限定する。
- PR本文に目的、背景、変更内容、理由、影響範囲、確認方法、テスト、レビュー観点、懸念点、rollout / rollbackを記載する。
