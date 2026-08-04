# Managed DB移行リスク台帳

最終更新: 2026-08-01

- 関連Issue: #131
- 状態: Open risks（設計時点）

## 評価基準

- 発生可能性: Low / Medium / High
- 影響: Low / Medium / High / Critical
- Ownerは役割名で管理し、実装Issueで担当者へ割り当てる。

## リスク一覧

| ID | リスク | 発生可能性 | 影響 | 予防策 | 検知 | Rollback / 対応 | Owner |
|---|---|---|---|---|---|---|---|
| DB-01 | Submissionとoutboxのatomicityが失われる | Medium | Critical | 同一transaction client、contract test、failure injection | Orphan submission / outbox invariant check | Deploy停止、adapter修正、cutover前はSQLiteへ戻す | API / DB |
| DB-02 | SQLiteとPostgreSQLのtransaction semantics差で二重claim・誤完了が起きる | Medium | Critical | Conditional UPDATE、`rowCount=1`、row lock test | Duplicate terminal event、attempt mismatch増加 | Worker停止、該当submission隔離、fencing修正 | Worker / DB |
| DB-03 | `BEGIN IMMEDIATE`除去後にstale recoveryが競合する | Medium | High | `SELECT ... FOR UPDATE`、current attempt再検証 | Recovery no-op / conflict event | Scanner停止、manual recovery | Worker / DB |
| DB-04 | SQLite export中にwriteが入りdata snapshotが不整合になる | Medium | Critical | Maintenance mode、process停止、file hash、export manifest | Row count / ID / FK mismatch | Import破棄、maintenance継続、再export | Operations |
| DB-05 | Import後にJSON・timestamp・nullable fieldが変質する | Medium | High | 初回はtext互換schema、NDJSON checksum、fixture test | Parse error、hash差異、invariant report | Target DB再作成、transform修正、再import | DB |
| DB-06 | Write再開後にSQLiteへ戻してPostgreSQL writeを失う | Medium | Critical | Write再開を不可逆checkpointとして承認、単純切戻し禁止 | Source / target latest timestamp差異 | PostgreSQL継続、PITR、承認済みreverse migration | Incident commander |
| DB-07 | Connection pool合計がDB上限を超える | Medium | High | Small pool、desired countとのbudget計算、alert | Pool timeout、too many connections | Task scale-in、pool max縮小、DB scale | Platform |
| DB-08 | RDS Proxyなしでfailover後のconnection recoveryが遅い | Low | Medium | Retry/backoff、connection reset test | Connection reset / recovery duration | Service restart、必要時RDS Proxy導入 | Platform |
| DB-09 | Secret rotation後も旧credentialを使用し続ける | Medium | High | Rotation runbookでservice redeploy、rotation event監視 | Authentication failure | Previous secret versionの緊急復旧、rolling redeploy | Security / Platform |
| DB-10 | Secretやconnection stringがlogへ露出する | Low | Critical | Config allowlist、raw error非露出、log test | Secret scanning、log review | Secret rotate、log purge手順、incident対応 | Security |
| DB-11 | API / Workerが同一DB userを使い最小権限が崩れる | Medium | High | Service別secret / role、grant validation | Permission snapshot diff | Grant revoke、task redeploy | Security / DB |
| DB-12 | Application roleへDDL権限が付く | Low | Critical | Migrator専用role、static grant test | `information_schema` grant audit | DDL revoke、credential rotate | Security / DB |
| DB-13 | DB SGが広域公開される | Low | Critical | SG source参照、PubliclyAccessible=false、IaC validator | AWS Config / change set review | SG rule即時削除、credential rotate | Platform / Security |
| DB-14 | TLS検証を無効化してMITM耐性を失う | Low | Critical | `verify-full`、CA bundle同梱、startup validation | TLS mode config test | Deploy rollback、connection block | Security / Platform |
| DB-15 | RDS CA更新で接続不能になる | Medium | High | Expiry inventory、dual CA bundle rehearsal | Certificate expiry alert | Bundle更新、rolling deploy | Platform |
| DB-16 | Migration taskが並行実行されschemaが破損する | Low | Critical | Advisory lock、migration checksum、single pipeline owner | Duplicate migration attempt event | Task停止、snapshot restore、manual repair | DB / Platform |
| DB-17 | Applied migration fileを書き換え履歴が不正になる | Low | High | Checksum検証、immutable migration rule | Checksum mismatch | New corrective migrationのみ許可 | DB |
| DB-18 | `MAX(version)+1`がconcurrent challenge version作成で競合する | Medium | High | Challenge row lock / unique retry、transaction化 | Unique violation | Retry、failed transaction rollback | API / DB |
| DB-19 | Outbox dispatcherを複数API taskで動かしduplicate publishが増える | High | Medium | desired count=1 gate、claim / lease先行 | Duplicate publish rate | Dispatcher scale-in、claim / lease導入 | API / Platform |
| DB-20 | Duplicate publishをDB fencingで無害化できないregression | Low | Critical | Attempt / key / completion guard contract test | Duplicate execution / terminal overwrite | Worker停止、message隔離、fencing修正 | Worker |
| DB-21 | Import artifactにsubmitted code / hidden testsが含まれ外部公開される | Medium | Critical | Public CI artifact禁止、encrypted storage、access log | Artifact inventory / access audit | Artifact削除、credential revoke、incident対応 | Security / Operations |
| DB-22 | Automated backupは存在するがrestore不能 | Medium | High | Restore drillを完了条件にする | Restore test failure | Backup設定修正、manual snapshot | Operations |
| DB-23 | Destructive migrationで旧applicationが動かなくなる | Medium | Critical | Expand / contract、compatibility window | Old task smoke failure | Previous schema compatible migration、snapshot restore | DB / Release |
| DB-24 | Driver移行とschema type最適化を同時に行い原因切り分け不能 | Medium | High | 初回はtext互換schema、別Issue化 | Diff size / test failure複合化 | PR分割、型変更revert | Tech lead |
| DB-25 | RDS費用がMVP予算を超える | Medium | Medium | Environment別size、cost budget / tag、Proxy defer | Cost Explorer / budget alert | Staging停止時間、instance resize | Product / Platform |
| DB-26 | Exact PostgreSQL version未固定で環境差が起きる | Medium | High | IaCでmajor / minor明示、CI version一致 | Version drift check | Version pin / rebuild | Platform / DB |
| DB-27 | Application startupでmigrationが走りservice rolloutが競合する | Medium | Critical | Startup DDL禁止、one-shot migrator | Startup log / schema lock | Task停止、migratorのみ実行 | Platform |
| DB-28 | DB障害詳細をlearner responseへ返す | Low | High | Internal / learner-safe error分離、response test | API contract test | Error mapper修正、deploy rollback | API / Security |

## Cutover blocker

以下が1件でも未達の場合、staging / production相当cutoverへ進まない。

- DB-01 / DB-02 / DB-03のcontract test成功
- Export manifest / checksum / invariant validation成功
- Service別DB role / secret / SG validation成功
- TLS certificate verification成功
- Backup取得とrestore drill成功
- Write再開後rollback方針の承認
- Outbox dispatcher scale gate設定
- Maintenance / incident commanderの明示

## Review cadence

- Adapter PRごとにDB-01〜DB-03を更新する。
- IaC PRごとにDB-07〜DB-17を更新する。
- Cutover rehearsal後に全riskの発生可能性とmitigationを再評価する。
- Production相当cutover後も未解消riskを`docs/risks/`で継続管理する。
