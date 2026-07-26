# Transactional Outbox 運用runbook

## 目的
submission作成とqueue publish intentを同一SQLite transactionで保存し、HTTP publish失敗時もpending outboxから再送できるようにする。

本runbookはIssue #117 / PR #118のPoC範囲を対象とする。

## 前提
- publish先は現行HTTP queue producerである。
- outboxのpublishedはHTTP producerが2xxを受けたことを示し、durable broker保存を意味しない。
- duplicate publishは正常な障害モードとして許容する。
- 採点correctnessはWorker conditional claim / attempt fencing / processing lease / completion guardが担う。
- SQLite DB fileを複数ホストから共有しない。

## 設定

| 環境変数 | 既定値 | 内容 |
|---|---:|---|
| `API_QUEUE_OUTBOX_ENABLED` | `0` | `1`または`true`でoutbox経路を有効化 |
| `API_QUEUE_OUTBOX_POLL_INTERVAL_MS` | `1000` | pending scan間隔 |
| `API_QUEUE_OUTBOX_BATCH_SIZE` | `25` | 一回のscan件数 |

intervalとbatch sizeは正のsafe integerでなければAPI起動時に失敗する。

## Rollout

1. DBバックアップ手順を確認する。
2. feature flagを無効のままmigrationを適用する。
3. `queue_outbox` tableと`idx_queue_outbox_pending`の存在を確認する。
4. legacy submission作成・採点が正常であることを確認する。
5. 限定環境で`API_QUEUE_OUTBOX_ENABLED=1`を設定する。
6. 正常submissionが201で受理され、outboxがpendingからpublishedへ遷移することを確認する。
7. Worker停止状態でsubmissionが201受理され、outboxがpendingを維持することを確認する。
8. Worker復旧後にpending rowがpublishされ、採点が完了することを確認する。
9. queue / outbox eventとAPI latencyを確認して対象環境を拡大する。

## 正常時確認
機微情報を含まない列だけを確認する。

```sql
SELECT
  status,
  COUNT(*) AS count,
  MAX(publish_attempts) AS max_attempts
FROM queue_outbox
GROUP BY status;
```

```sql
SELECT
  id,
  submission_id,
  grading_attempt,
  status,
  created_at,
  last_attempted_at,
  published_at,
  publish_attempts,
  last_error_type
FROM queue_outbox
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 50;
```

`message_json`には内部attempt keyが含まれるため、通常の運用確認や外部共有へ出力しない。

## 主要event
- `queue.outbox.publish_succeeded`
- `queue.outbox.publish_failed`
- `queue.outbox.dispatch_completed`
- `queue.outbox.dispatch_failed`
- `queue.enqueue.succeeded`
- `queue.enqueue.failed`
- `queue.delivery.accepted`
- `queue.claim.succeeded`
- `queue.claim.noop`

ログへcode、tests、secret、attempt key、raw error messageを出さない。

## 障害判定

### pendingが増え続ける
確認順:
1. Worker `/health`が成功するか。
2. APIの`RUNNER_API_BASE_URL`が正しいか。
3. `queue.enqueue.failed`のoutcome / reason / generalized error typeを確認する。
4. `queue.outbox.dispatch_failed`が継続していないか確認する。
5. API processがpollingを継続しているか確認する。

対応:
- Workerまたはnetworkを復旧する。
- APIを再起動しstartup dispatchを実行する。
- pending rowを手動でpublishedへ変更しない。
- submission statusやattempt keyを手動変更しない。

### publish成功後もpendingが残る
outboxのpublished更新失敗が考えられる。messageは既にWorkerへ届いている可能性がある。

対応:
- rowをpendingのまま維持する。
- 次回dispatchによるduplicate publishを許容する。
- Workerの`queue.claim.noop`を確認する。
- exactly-onceを前提に手動削除しない。

### invalid message
`queue.outbox.publish_failed`のreasonが`invalid_message`の場合、DB row破損またはcontract不整合を疑う。

対応:
- `message_json`を外部ログへ出さず、権限を限定して内部確認する。
- submission ID / grading attempt / schema versionの整合性を確認する。
- rowを無断修正せず、原因調査Issueを作成する。

### dispatcher DB更新失敗
`failure_state_update_failed`または`publish_state_update_failed`を確認する。

対応:
- SQLite file権限・disk容量・lock状況を確認する。
- APIを再起動する。
- rowはpendingのまま再送対象として扱う。

## Rollback

1. `API_QUEUE_OUTBOX_ENABLED=0`へ戻す。
2. APIを再起動する。
3. legacyのsubmission保存→同期HTTP enqueueへ戻ったことを確認する。
4. `queue_outbox` tableは削除しない。
5. pending rowは将来の再有効化・調査に備えて保持する。
6. DB migration rollbackは原則行わない。

注意:
- rollback後に作成されたsubmissionはoutbox rowを持たない。
- rollback前のpending outboxは自動publishされなくなる。
- Worker queued startup recoveryは独立したavailability safety netとして維持される。

## PoCの未対応範囲
- outbox claim / lease
- multi-host SQLite
- SQS等の実broker adapter
- broker ack / visibility timeout
- DLQ / replay / purge / retention
- outbox admin API / UI
- pending count / oldest age metrics backend
- service-to-service認証の本番設定

## エスカレーション条件
次の場合はfeature flagを無効化し、原因調査Issueを作成する。

- pending件数が継続的に増加する。
- API latencyが許容範囲を超える。
- duplicate deliveryでWorker claim以外の副作用が確認される。
- outbox insert失敗でsubmissionだけが残る。
- learner responseやログへoutbox内部情報が漏れる。
