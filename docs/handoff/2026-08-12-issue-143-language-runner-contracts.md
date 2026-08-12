# Issue #143 handoff

## 現在地

- Issue: #143
- PR: #144
- Branch: `feat/language-runner-contracts`
- Follow-up: #145
- Production runtime: SQLite / HTTPを維持

## 実装済み

- Runner contractを`packages/runner-sdk/src/runner-contract.mjs`へ集約。
- Public runner:
  - JavaScript / TypeScript: Node test
  - SQL: read-only SQLite
  - HTML/CSS: static evaluator
- Python: `python-container` isolated-preview。Public submissionは拒否。
- SQL / HTML-CSS E2E。
- Python実Docker contract test。
- Challenge 7件→9件。
- Workerが`submission.language`をRunnerへ明示伝播。

## Python本番公開blocker

Issue #145で以下を実装するまでPythonを公開しない。

- Workerから分離した専用remote / ECS Task系Runner。
- Docker socketをWorkerへ公開しない。
- submitted codeからhidden test fileを読めないfilesystem isolation。
- resource / timeout / network / privilege制限の本番保証。
- orphan cleanup / retry / idempotency。
- quota / concurrency / cost control。
- staging adversarial test。

## CI

Code head `a7c99aad7e26044c943bb423bcfd01f1d87c572d`でdocs-validation / app-quality成功。

app-quality:

- frozen install
- lint
- typecheck
- unit
- integration
- PostgreSQL 18.4 integration
- SQL / HTML-CSS E2E
- Python固定Docker image pull / container contract
- schema
- infra
- build

すべて成功。

## Ready移行前の残作業

1. docs-only最終headのCI確認。
2. PR本文を最終head / CI / self-review内容へ更新。
3. Issue #143へ最終コメント。
4. Notionを同期。
5. PR #144をReady for reviewへ移行。
6. 自動レビューが入った場合は妥当な指摘を修正して全CIを再確認。

## 次の候補

ユーザー価値を優先する場合:

1. #145 Python本番隔離Runner。
2. Challenge tag検索 / 学習トラック。
3. おすすめChallenge / 次に解く問題。
4. 進捗ページ実データ化。

基盤移行を優先する場合:

1. Submission read / simple write async DatabaseClient移行。
2. processing lease / attempt fencing async移行。
3. submission + outbox atomic transaction async移行。
