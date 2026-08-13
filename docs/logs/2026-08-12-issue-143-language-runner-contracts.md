# Issue #143 実装ログ

日付: 2026-08-12
Issue: `#143 SQL・Python・HTML/CSS向け言語別Runner contractを導入する`
PR: `#144 SQL・HTML/CSS Runnerを追加しPython隔離Runner contractを整備`
Branch: `feat/language-runner-contracts`
Follow-up: `#145 Python Runnerの本番隔離実行基盤を導入する`

## 目的

Problem schemaで定義可能な言語と実際のWorker実行能力を一致させ、任意shell commandを導入せずにSQL / HTML-CSSを提出可能化する。Pythonは安全な隔離contractを先行整備する。

## 実装

- Runner kindを`runner-sdk`へ集約。
- JS/TS: Node test。
- SQL: 参照専用SQLite evaluator。
- HTML/CSS: trusted Node testによる静的評価。
- Python: digest固定Docker container preview。
- Web / API / Workerの公開allowlistを共通化。
- WorkerへSubmission languageを明示伝播。
- Challenge 7件→9件。
- SQL既存Challengeを実採点可能化。
- HTML/CSS / Python Challengeを各1件追加。

## CIで検出した問題

1. `python:3.14.6-alpine3.22`はmanifestが存在せずpull失敗。
   - `python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd`へ固定。
2. PR #142時点のSQL拒否unit testが新仕様と衝突。
   - SQL正規languageは許可、language spoofは拒否、Pythonは拒否へ更新。
3. Node Runner timeoutに対して既存api-flowのpolling窓が不足。
   - 既存障害注入fixtureは維持し、polling上限のみ拡張。
4. polling修正時に一時的に既存fixtureまで変更した差分を検出。
   - mainのRepository fixture + queue message方式へ戻した。

## 自己レビューで追加修正した事項

- Python stdout/stderr captureを256KiBへ制限。
- Python containerをnon-root化。
- capability全削除 / no-new-privileges / nodev tmpfs / nofile制限を追加。
- WorkerがChallenge先頭languageを推測していたため、`submission.language`をRunnerへ明示伝播。
- 複数対応Challengeで明示languageが優先されるunit testを追加。
- Python submitted codeからhidden test fileを読める可能性を本番公開blockerとして#145へ切り出し。

## テスト

Code head `a7c99aad7e26044c943bb423bcfd01f1d87c572d`で全quality gate成功。

- lint / typecheck / unit / integration / schema / infra / build。
- SQL / HTML-CSS starter failure / reference solution success。
- SQL / HTML-CSS API → queue → Worker E2E。
- Python Public API 400 fail-closed。
- Python固定image実pull / 実container contract。
- PostgreSQL 18.4 integration。
- learner-safe hidden test境界。

## 境界

- API processでsubmission codeを実行しない。
- Problem JSON由来commandをshell実行しない。
- Pythonは#145完了まで公開しない。
- Submission + outbox atomicityを変更しない。
- lease / fencing / completion guardを変更しない。
- Production runtimeはSQLite / HTTPを維持する。
