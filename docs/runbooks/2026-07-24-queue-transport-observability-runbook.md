# 2026-07-24 Queue transport observability runbook（Issue #113）

## 目的

現行HTTP queueのenqueue・delivery・claim・retry・recoveryを、機微情報を含めない構造化eventから調査し、採点停止・retry storm・stale増加・契約不一致を早期に発見する。

## 対象

- API / Workerのqueue関連JSON Lines
- HTTP enqueue
- Worker `/jobs` delivery
- DB conditional claim
- processing heartbeat
- application retry
- Worker起動時queued recovery
- stale running recovery

## 対象外

- Prometheus / OpenTelemetry / Datadog等の製品固有設定
- metrics endpoint
- dashboard実装
- alert通知先の本番設定
- external queue / DLQの実体運用

## event形式

一行につき一つのJSON objectを出力する。

```json
{
  "timestamp": "2026-07-24T00:00:00.000Z",
  "level": "info",
  "service": "worker",
  "event": "queue.delivery.accepted",
  "transport": "http",
  "outcome": "accepted",
  "submissionId": "opaque-id",
  "gradingAttempt": 1,
  "schemaVersion": 1
}
```

### 必須field

- `timestamp`
- `level`
- `service`
- `event`

### 許可context

- `transport`
- `source`
- `outcome`
- `reason`
- `submissionId`
- `gradingAttempt`
- `previousAttempt`
- `nextAttempt`
- `correlationId`
- `schemaVersion`
- `statusCode`
- `field`
- `trigger`
- `scanned`
- `requeued`
- `terminalized`
- `enqueueFailedFinalized`
- `noOp`
- `errors`
- `count`
- `errorType`

### 記録禁止

- 提出コード本文
- visible / hidden tests詳細
- challenge本文
- secret / token / password
- attempt idempotency key
- raw error message
- 認証header
- learnerへ不要なendpoint情報

## event一覧

### enqueue

- `queue.enqueue.succeeded`
  - HTTP 2xxでWorker通知に成功した。
- `queue.enqueue.failed`
  - contract rejection、HTTP非2xx、network error、message build失敗。

主な`reason`:
- `unknown_field`
- `unsupported_schema_version`
- `message_build_failed`
- `http_non_2xx`
- `network_error`

### delivery

- `queue.delivery.accepted`
  - Workerが共通message contractを受理し202を返した。
- `queue.delivery.rejected`
  - invalid JSONまたはcontract不一致で400を返した。

### claim

- `queue.claim.succeeded`
  - DB conditional claimに成功して`running`へ進んだ。
- `queue.claim.noop`
  - 採点を実行しない安全なno-op。

主な`reason`:
- `submission_not_found`
- `attempt_mismatch`
- `conditional_claim_failed`

### heartbeat

- `queue.heartbeat.failed`
  - heartbeat DB更新で例外が発生し、Workerが所有権を放棄した。

### application retry

- `queue.retry.pending`
- `queue.retry.started`
- `queue.retry.enqueue_succeeded`
- `queue.retry.enqueue_failed`
- `queue.retry.terminalized`

transport retryではなく、infrastructure failureに伴うnew grading attemptの状態を表す。

### queued startup recovery

- `queue.queued_recovery.completed`
  - Worker起動時に検出したqueued件数を記録する。
- `queue.queued_recovery.failed`
  - queued一覧取得または処理予約に失敗した。

### stale recovery

- `queue.stale_recovery.completed`
- `queue.stale_recovery.enqueue_failed`
- `queue.stale_recovery.candidate_failed`
- `queue.stale_recovery.scan_completed`
- `queue.stale_recovery.scan_failed`

`scan_completed`はstartup scan、候補あり、またはerrorありの場合に記録する。空のperiodic scanはログ量抑制のため出力しない。

## metric変換候補

外部backend導入時はJSON eventを次のcounterへ変換する。

| Metric候補 | 元event | 主なlabel |
|---|---|---|
| `queue_enqueue_total` | `queue.enqueue.*` | outcome, reason, source |
| `queue_delivery_total` | `queue.delivery.*` | outcome, reason |
| `queue_claim_total` | `queue.claim.*` | outcome, reason |
| `queue_heartbeat_failure_total` | `queue.heartbeat.failed` | service |
| `queue_retry_total` | `queue.retry.*` | event, outcome, reason |
| `queue_queued_recovery_total` | `queue.queued_recovery.*` | event, outcome |
| `queue_stale_recovery_total` | `queue.stale_recovery.*` | event, outcome, reason |
| `queue_stale_scan_candidates_total` | `queue.stale_recovery.scan_completed` | trigger |
| `queue_stale_scan_errors_total` | `queue.stale_recovery.scan_completed` | trigger |

submission IDやcorrelation IDをmetric labelに使用しない。cardinalityが増加するため、調査用ログfieldとしてのみ扱う。

## alert候補

初期値は環境・採点SLOが未確定のため要確認とする。

### P1候補

- 5分間の`queue.enqueue.failed`率が5%以上
- `queue.queued_recovery.failed`が1回以上
- `queue.stale_recovery.scan_failed`が連続2回以上
- `queue.heartbeat.failed`が同一時間帯に急増
- `queue.retry.enqueue_failed`が1回以上
- `queue.retry.terminalized`または`queue.stale_recovery.enqueue_failed`が連続発生

### P2候補

- `queue.delivery.rejected`が継続発生
- `queue.claim.noop{reason="attempt_mismatch"}`が平常時より増加
- startup queued recovery件数が継続的に増加
- stale scanの`noOp`または`errors`が増加

## 障害調査手順

### enqueue failure

1. `queue.enqueue.failed`の`reason`と`source`を確認する。
2. `http_non_2xx`の場合は`statusCode`を確認する。
3. `network_error`の場合はWorker healthとネットワーク到達性を確認する。
4. DB上のsubmissionが`queued`で残っていることを確認する。
5. Worker起動時queued recoveryまたは運用者判断による再投入を優先する。
6. grading attemptを増やさない。

### delivery rejection

1. `queue.delivery.rejected`の`reason`、`field`、`schemaVersion`を確認する。
2. producer / consumerが同一versionを使用していることを確認する。
3. unknown fieldの場合はqueue messageへ禁止情報が混入していないか確認する。
4. raw payloadや提出コードをログへ追加して調査しない。
5. contract修正またはproducer rollbackを判断する。

### claim no-op増加

1. `reason`別に件数を確認する。
2. `attempt_mismatch`はold message / duplicate deliveryの有無を確認する。
3. `conditional_claim_failed`はterminal済み、他Worker取得済み、completion guard設定済みを確認する。
4. no-op自体をエラーとして再実行しない。
5. correctness異常が疑われる場合はDB current stateとattempt fencingを確認する。

### retry / stale recovery異常

1. `queue.retry.*`または`queue.stale_recovery.*`をsubmission IDで時系列に並べる。
2. previous / next attempt番号が連続していることを確認する。
3. enqueue failure後にterminalizedされたか確認する。
4. retry上限到達時に`infra_failed`とcompletion guardが保存されたか確認する。
5. stale recoveryではlease非NULL・期限切れ・expected attempt/key/lease条件を確認する。
6. old attemptの遅延更新がno-opになっていることを確認する。

## ロールアウト

1. JSON Linesを収集できる環境でPR #114対応Worker / APIをdeployする。
2. `queue.enqueue.*`と`queue.delivery.*`の対応件数を確認する。
3. 正常submissionでdelivery accepted → claim succeededが確認できることを確認する。
4. duplicate / missing submissionでclaim no-opが確認できることを確認する。
5. retry / stale recovery環境でattempt遷移eventを確認する。
6. ログにcode / hidden tests / secret / attempt key / raw error messageが含まれないことを確認する。
7. event volumeと保存コストを確認する。
8. metric backend・dashboard・本番alertは別Issueで段階導入する。

## ロールバック

- PR #114をrevertし、従来のconsole logへ戻す。
- DB schema変更はないためmigration rollbackは不要。
- queue message contract / HTTP adapter / processing lease / attempt fencing / completion guard / stale scannerは維持する。
- observability failureを理由にsubmission状態を手動変更しない。

## 確認コマンド例

JSON Linesをローカルファイルへ保存した場合の例。

```bash
jq 'select(.event == "queue.enqueue.failed")' worker.log
jq 'select(.event == "queue.delivery.rejected") | {timestamp, reason, field, schemaVersion}' worker.log
jq 'select(.submissionId == "opaque-id") | {timestamp, event, outcome, reason, gradingAttempt, previousAttempt, nextAttempt}' worker.log
```

## 関連

- Issue #113: `https://github.com/mizzz-ivr/ai-code-dojo/issues/113`
- PR #114: `https://github.com/mizzz-ivr/ai-code-dojo/pull/114`
- Issue #111 / PR #112: queue message contract / HTTP adapter
- Issue #109 / PR #110: queue運用設計
- `docs/runbooks/2026-05-18-worker-failure-recovery-runbook.md`
- `docs/architecture/system-overview.md`
