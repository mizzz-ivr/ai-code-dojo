# Database provider contract検証runbook

## 目的

DB adapter変更時にSQLiteとPostgreSQL境界の意味論が一致し、既存runtimeへ影響しないことを確認する。

## 実行

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm schema:validate
pnpm infra:validate
pnpm build
```

## 必須確認

- SQLiteとPostgreSQLの共通contract testが両方成功する。
- query rowがplain objectへ正規化される。
- execute結果が`rowCount` / `lastInsertId`へ正規化される。
- commit後だけ変更が見える。
- operation例外時にrollbackされる。
- nested transactionが拒否される。
- closeが冪等で、close後操作が拒否される。
- 未対応`DB_PROVIDER`が起動前に拒否される。

## 現時点の制約

- PostgreSQL側はfake poolによるunit testであり、実DB検証ではない。
- 既存Repositoryは新adapterを使用していない。
- `DB_PROVIDER=postgresql`をproductionで設定しない。

## 失敗時

- provider固有差異はadapterで吸収し、共通contract testを緩めない。
- rollback failureが元例外を上書きしていないか確認する。
- SQLやparametersをCI logへ追加しない。
