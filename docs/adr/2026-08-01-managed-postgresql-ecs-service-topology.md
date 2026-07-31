# Managed PostgreSQL移行とECS service分離構成

最終更新: 2026-08-01

- 状態: Accepted（設計確定、実装未着手）
- 関連Issue: #131
- 前提PR: #130

## 目的

現行SQLiteの単一ファイル制約を解消し、API / Workerを別ECS taskへ安全に分離できるManaged DB移行方針を確定する。

## 背景

現行は`node:sqlite`とprocess working directory配下の`.data/app.db`を利用している。

- API / Workerを別taskへ分離するとSQLite fileを共有できない。
- API / Workerを同一taskへ同居させるとtask roleが共通になり、API producerとWorker consumer / retry producerのIAM最小権限を分離できない。
- Repository層は`DatabaseSync`、`?` placeholder、`PRAGMA`、`BEGIN IMMEDIATE`、`write.changes`へ直接依存している。
- Transactional outbox、processing lease、attempt fencing、completion guardはDB transactionと条件付き更新の正しさに依存する。

このため、ECS wiringより先にDB engine、接続境界、transaction semantics、migration ownership、cutover / rollbackを確定する必要がある。

## 決定事項

### 1. Managed DB

初期Managed DBとして**Amazon RDS for PostgreSQL（provisioned）**を採用する。

- DB instanceはprivate subnetへ配置し、PubliclyAccessibleを無効にする。
- Storage encryption、automated backup、PITR、deletion protectionを有効にする。
- Production相当環境ではMulti-AZを採用する。Stagingの可用性構成は費用と検証目的に応じて別parameterとする。
- PostgreSQL major / minor versionはIaC実装Issueで明示固定し、自動major upgradeへ依存しない。
- 初回移行では既存の論理schemaと値表現を優先し、ID・JSON文字列・ISO 8601 UTC timestampの互換性を維持する。`uuid`、`jsonb`、`timestamptz`への最適化はcutover後の別Issueとする。

### 2. ECS実行トポロジー

APIとWorkerを別ECS service / task definitionへ分離する。

- `api-service`
  - 外部HTTP境界を担当する。
  - API専用task roleを使用する。
  - SQS source queueへの`SendMessage`以外のqueue権限を持たない。
- `worker-service`
  - Queue consume、採点、retry、stale recoveryを担当する。
  - Worker専用task roleを使用する。
  - Source queueへのReceive / Delete / ChangeVisibility / Sendだけを持つ。
- `db-migrator-task`
  - one-shot taskとしてschema migrationだけを担当する。
  - API / Worker起動時にDDLを実行しない。
  - 単一migration ownerとadvisory lockで並行migrationを防止する。

APIとWorkerを同一task definitionへ同居させない。

### 3. Database role分離

PostgreSQL roleを用途別に分離する。

- `dojo_migrator`
  - schema owner / DDL実行者。
  - 通常serviceから利用しない。
- `dojo_api`
  - challenge管理、submission作成・参照、queue outbox作成・publish状態更新に必要なDMLだけを許可する。
- `dojo_worker`
  - challenge参照、submission claim / heartbeat / retry / terminal保存に必要なSELECT / UPDATEだけを許可する。
  - challenge更新、queue outbox更新、DDLを許可しない。

AWS task roleとPostgreSQL roleは別の境界として管理する。

### 4. Credential方式

初期実装はSecrets Managerで管理するpassword認証を採用する。

- API / Worker / migratorで別secretと別DB userを使用する。
- ECS task definitionの`secrets`から必要なJSON keyだけを注入する。
- Secret取得権限はtask execution roleへ限定し、application task roleへ不要なSecrets Manager権限を付けない。
- Secret rotation後はrunning taskへ自動反映されないため、rotation runbookでservice再deployを必須とする。
- IAM DB authenticationはtoken更新とconnection pool lifecycleの実装負荷が増えるため初回移行では採用しない。別Issueで再評価する。

### 5. Network / TLS

- RDSへpublic routeを持たせない。
- DB security groupはAPI service security groupとWorker service security groupからのTCP 5432だけを許可する。
- Migrator taskはmigration実行時だけ接続可能なsecurity groupを使用する。
- DB接続はTLS必須とし、client側でCA検証を行う。
- `sslmode=verify-full`相当を基準とし、CA bundle更新を運用項目に含める。
- DB endpoint、DB name、portは通常environment、username / passwordはsecretとして分離する。

### 6. Database adapter

Repository層からdriver固有APIを除去し、async `DatabaseClient`境界を導入する。

最小contract:

```text
queryOne(statement, params) -> row | null
queryMany(statement, params) -> rows[]
execute(statement, params) -> { rowCount }
transaction(callback) -> callback result
close() -> void
```

- PostgreSQL driverがasyncであるため、Repository層は全経路で`await`する。
- Canonical placeholderは`$1`, `$2`, ...とする。
- SQLite互換期間はadapter内でplaceholderを安全に変換し、Repositoryへdriver差を漏らさない。
- `write.changes`は`rowCount`へ正規化する。
- Transaction callbackは同じconnection / clientへ固定する。
- 初回移行ではORM / query builderを導入しない。Repository rewriteとORM導入を同一PRへ混在させない。

### 7. Transaction / concurrency semantics

以下の不変条件をPostgreSQLでも維持する。

- Submissionとqueue outboxは同一transactionでcommitする。
- Claim / heartbeat / completionはexpected attempt / key / lease / completion guardをWHERE条件で検証する。
- 条件付きUPDATEの`rowCount = 1`だけを所有権取得・保存成功とみなす。
- Stale recoveryのmulti-step更新は同一transaction内で対象rowを`SELECT ... FOR UPDATE`してから実行する。
- Queue deliveryのexactly-onceへ依存しない。
- Outbox dispatcherの複数instance運用は、claim / leaseまたは`FOR UPDATE SKIP LOCKED`実装後にだけ許可する。

### 8. RDS Proxy

初回移行ではRDS Proxyを採用しない。

- API / Workerごとに小さい固定connection poolを持つ。
- Pool上限の合計がDB `max_connections`の安全枠を超えないようIaC parameterとrunbookで管理する。
- Connection churn、failover recovery、burstによるconnection圧迫が観測された場合にRDS Proxyを別Issueで導入する。

### 9. Cutover方式

SQLiteからPostgreSQLへの初回cutoverは短時間メンテナンス方式とする。

1. PostgreSQL schemaとapplication互換性をstagingで検証する。
2. Production相当のwriteを停止し、APIをmaintenance / read-only状態にする。
3. SQLite fileを停止状態でbackupする。
4. Export toolでtable dataを決定的な順序と形式へ出力する。
5. PostgreSQLへtransactional importする。
6. 件数、ID集合、FK、unique制約、submission / outbox不変条件を検証する。
7. API / WorkerをPostgreSQL providerで起動する。
8. Smoke test成功後にwriteを再開する。

SQLiteには標準CDCを導入しないため、初回cutoverでzero downtimeを目標にしない。

### 10. Rollback境界

- Write再開前: PostgreSQL serviceを停止し、SQLite backupへ戻せる。
- Write再開後: PostgreSQLへ新規writeが発生するため、単純なSQLite切戻しを禁止する。
- Write再開後のrollbackは、PostgreSQL snapshot / PITR、または明示的なreverse migration手順を必要とする。
- Cutover承認では「write再開」を不可逆checkpointとして扱う。

## 不採用案

### Shared EFS上のSQLite

- SQLite file locking、latency、障害時整合性、複数task writeの運用リスクが高い。
- Managed relational DBへの移行を先送りするだけである。

### API / Worker同一ECS task

- task roleが共通になり、SQS producer / consumer権限分離を維持できない。
- Scale、deploy、障害範囲も不必要に結合する。

### Aurora Serverless v2を初期採用

- 現MVPの負荷要件に対して構成・費用・運用判断が増える。
- RDS PostgreSQLで不足が観測されてから再評価する。

### IAM DB authenticationを初期採用

- 15分tokenの更新、pool内connection更新、障害切り分けを同時に導入することになる。
- Password + Secrets Manager + TLSで初回移行範囲を限定する。

### Big-bang repository rewrite

- Driver変更、SQL変更、data type変更、ECS化を同一PRで行うとrollbackとレビューが困難になる。
- Adapter、schema、repository、IaC、cutover、ECS wiringを段階分割する。

## 影響

### 良い影響

- API / Workerを別task roleへ分離できる。
- SQLite `database is locked`を本番運用上の共有DB制約から除去できる。
- Horizontal scaleとManaged backup / PITRの前提を作れる。
- Migration ownerとapplication DML権限を分離できる。

### コスト・複雑性

- Async DB adapterへのRepository移行が必要になる。
- Connection pool、secret rotation、TLS CA、backup、migration runbookの運用が増える。
- PostgreSQL concurrency semanticsを前提に回帰テストを追加する必要がある。

## 後続Issue分割

1. DB adapterとSQLite / PostgreSQL repository contract test基盤
2. Versioned migration runnerとPostgreSQL互換schema
3. Submission / challenge / outbox repositoryのasync adapter移行
4. Outbox claim / leaseと複数API instance安全化
5. RDS PostgreSQL / Secrets Manager / security groupのIaC
6. SQLite export / PostgreSQL import / validation tool
7. API / Worker / migrator ECS task definition・service wiring
8. Staging cutover rehearsalとrollback drill
9. Production相当cutoverとSQS transport切替

## リスク

詳細は`docs/risks/2026-08-01-managed-db-migration-risks.md`を正本とする。

## 未確定事項

- PostgreSQL major / minor version
- StagingでMulti-AZを有効にするか
- Secret rotation方式と頻度
- RDS Proxy導入threshold
- Production相当cutover日時と許容停止時間

これらはIaC / cutover実装Issueで確定する。

## 参考

- AWS ECS task IAM role: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
- AWS ECS Secrets Manager injection: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html
- RDS for PostgreSQL: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html
- RDS PostgreSQL TLS: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html
- RDS Proxy: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html
- PostgreSQL row locking: https://www.postgresql.org/docs/current/sql-select.html
