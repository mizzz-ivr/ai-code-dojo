# Issue #113 Codex Prompt

あなたは `mizzz-ivr/ai-code-dojo` のシニアPM・テックリード・ソフトウェアアーキテクト・レビュアーとして作業してください。

`docs/ai-protocol/PROMPT.txt` を最優先ルールとして遵守してください。

## 対象

- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- 作業branch: `feat/queue-transport-observability`
- 想定PR: #114

## 目的

現行HTTP queueのenqueue / delivery / claim / retry / stale recoveryを、機微情報を含めない構造化eventとして観測可能にしてください。

外部監視製品は導入せず、将来のログ集約・metrics変換・alert設定へ接続できる安定したevent contractを実装してください。

## 必須要件

1. queue event loggerを追加する。
2. 一event一JSON objectのJSON Linesでstdout / stderrへ出力する。
3. event nameを定数として固定する。
4. context fieldをallowlist方式にする。
5. unknown / nested / non-primitive fieldを出力しない。
6. string fieldを適切に長さ制限する。
7. logger出力失敗をenqueue / grading / recoveryへ伝播しない。
8. enqueue success / failure / contract rejectionを記録する。
9. Worker delivery accepted / rejectedを記録する。
10. conditional claim success / no-opを記録する。
11. heartbeat failureを記録する。
12. application retryのpending / new attempt / enqueue / terminalizeを記録する。
13. Worker起動時queued recoveryの件数・失敗を記録する。
14. stale recovery candidate / scan結果を同じevent contractへ統一する。
15. unit / integration testを追加する。
16. current-status / active-issues / system-overview / runbook / logs / ai-prompts / handoffを更新する。

## ログへ含めてよい情報

- UTC timestamp
- level
- service
- stable event name
- transport / source / outcome / generalized reason
- opaque submission ID
- grading attempt / previous attempt / next attempt
- optional opaque correlation ID
- schema version
- HTTP status code
- rejected field name
- scan trigger / aggregated counts
- generalized error type

## ログへ含めてはいけない情報

- 提出コード本文
- visible / hidden tests詳細
- challenge本文
- secret / token / password
- auth header
- attempt idempotency key
- raw error message
- environment variable値
- learnerへ不要なendpoint情報

## 不変条件

- APIプロセスで提出コードを直接実行しない。
- hidden tests詳細をlearnerへ返さない。
- hidden tests実データをIssue / PR / docs / logsへ記録しない。
- challengeはversion追加方式を維持し、既存versionを上書きしない。
- transport retryでgrading attempt / attempt keyを変更しない。
- processing lease / attempt fencing / completion guardを維持する。
- observability失敗へ採点correctnessを依存させない。
- DB schema / migration / seedを変更しない。
- Runner / auth / admin / UI / deploymentを変更しない。
- 無関係なリファクタリングを混在させない。

## 非対象

- Prometheus / OpenTelemetry / Datadog等の導入
- metrics endpoint
- dashboard
- alert本番設定
- external queue / transactional outbox
- visibility timeout / ack / nack / DLQ実装
- application retry backoff
- Runner・採点仕様変更

## テスト観点

### 正常系

- queue eventがvalid JSON一行として出力される。
- enqueue successが記録される。
- delivery acceptedが記録される。
- claim successが記録される。
- retry / stale recoveryの状態遷移が記録される。

### 異常系

- HTTP非2xx、network error、contract不正がgeneralized reasonで記録される。
- invalid JSON / invalid schemaがdelivery rejectedになる。
- claim no-op理由が記録される。
- heartbeat / recoveryエラーがraw messageなしで記録される。
- logger sink失敗が業務処理へ伝播しない。

### セキュリティ

- code / hidden tests / secret / attempt key / raw error messageが出力されない。
- unknown fieldが出力されない。
- learner-safe APIレスポンスが変化しない。

### 回帰

- API submission作成
- Worker retry
- stale recovery
- queued startup recovery
- processing lease / heartbeat
- attempt fencing / completion guard

## 品質ゲート

以下をすべて成功させてください。

- docs validation
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm schema:validate`
- `pnpm build`

## 最終出力

日本語で以下をまとめてください。

1. Summary
2. Completed Tasks
3. Changed Files
4. Technical Decisions
5. Security / Invariants
6. Test Results
7. Risks
8. Remaining Tasks
9. Suggested Next Actions
10. Agent Handoff
