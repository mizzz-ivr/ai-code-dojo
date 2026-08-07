# Issue #139 Handoff

## 状態

- Issue: #139
- PR: #140
- Branch: `feat/challenge-repository-async-db`
- Linear: 無料Issue上限のため未作成
- Production runtime: SQLite / HTTPを維持

## 実装済み

- Admin Challenge Repository factory
- async DatabaseClient dependency
- 現行SQLite runtime adapter境界
- Challenge + Version 1 atomic create
- Version append + current pointer atomic update
- PostgreSQL同時Version追加のrow lock
- SQLite / PostgreSQL共通Repository contract
- 実PostgreSQL concurrency integration test

## 変更していないもの

- Public Challenge Repository
- `problems/examples`からのコンテンツ配信
- Public Challenge API data source
- Submission / lease / outbox
- Production DB provider

## 重要な判断

- Repository移行とprovider切替を分離する。
- Challenge更新は既存Versionを書き換えず、新Versionを追加する。
- Version番号採番は同一Challenge単位で直列化する。
- Hidden testsはAdmin / internal payloadへ保持するがlearner向け公開境界へ出さない。
- Runtime SQLite connectionのlifecycle ownerは変更しない。

## 次の推奨Issue

Submission Repositoryのread / simple writeをasync DatabaseClientへ移行する。

最初のPRでは以下へ限定する。

- Submission create
- Submission get / listなど単純read
- Status / resultの単純更新のうちlease / fencingに依存しない処理
- SQLite / PostgreSQL共通contract

次のPRへ残すもの:

- processing claim / heartbeat / lease
- attempt idempotency fencing
- completion guard
- stale recovery
- submission + queue outbox atomic transaction

## 次Issueのgate

- Existing API responseを変更しない。
- Submitted codeやhidden testsをログへ出さない。
- Conditional UPDATEのownership判定を弱めない。
- Submission + outbox atomicityへ影響する処理は別PRへ分離する。
- Production provider defaultはSQLiteのまま維持する。
