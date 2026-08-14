# active-issues（正本）

最終更新: 2026-08-13（Issue #145 / PR #146 Python Remote Runner）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #145 Python Runnerの本番隔離実行基盤を導入する

- 優先度: P1
- 状態: Open / PR #146 Ready for review / mergeable
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/145`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/146`
- Branch: `feat/python-remote-isolation-runner`
- Linear: 無料Issue上限のためGitHub Issue / Repository docs / Notionを管理正本とする。

#### 目的

Issue #143で追加したPython isolated-previewを、WorkerへDocker socketを公開せず専用Remote Runnerへ分離し、submitted codeからhidden test file自体を読めない実行境界へ移行する。

#### PR #146で実装済み

- `apps/python-runner`専用service。
- Workerは署名付きHTTP clientのみ。Python Docker実行コードをWorkerから削除。
- HMAC SHA-256署名契約を`packages/runner-sdk`へ分離。
- Production Remote URLはHTTPS必須。
- credentials / query / fragment付きURLを拒否。
- timestamp / idempotency key / bodyの改ざん検知。
- request / response size、timeout、concurrency、queueを有限化。
- 同一idempotency keyのresult再利用とpayload conflict拒否。
- pinned Python image digest。
- network none / read-only / non-root / capability drop / no-new-privileges。
- CPU / memory / pids / fd / timeout制限。
- timeout時container削除 / startup orphan cleanup境界。
- `.py` hidden test直接実行を廃止し、JSON case + trusted comparatorへ移行。
- sandboxへは`submission.py`と汎用invoke harnessだけをmount。
- hidden case / expected valueは信頼側processだけが保持。
- submitted codeからhidden test filesystemを参照できない実Docker integration test。
- Worker client → Remote Runner → actual Docker → Python sandboxの実HTTP integration test。
- SyntaxError / runtime failure / timeout / protocol failureをterminal grading failureとして扱い、ユーザーコード起因の不要なinfra retryを防止。
- Docker起動不可等の実行基盤failureのみinfra retry対象。

#### CI状況

Ready移行前のcode/docs head `3b5a83fe13ec8d9f9febfdf1d0aec30fb3ec5a47`で以下がすべてSuccess。

- Docs validation
- Frozen lockfile install
- Lint
- Typecheck
- Unit test
- Integration test
- Schema validation
- Infra validation
- Build
- PostgreSQL 18.4 integration
- Python actual Docker contract
- hidden test filesystem isolation
- Worker → Remote Runner → Docker E2E
- HMAC 401 / idempotency conflict 409
- SyntaxError / timeout terminal grading契約

初回CI / 自己レビューで以下を検出・修正した。

1. JSON request bodyをliteral multiline codeで比較していたunit testの期待値ミス → JSON parse後のcode一致へ修正。
2. `mkdtemp`の0700 directoryをnon-root containerが読めない問題 → 実行中だけ0555、cleanup前に0700へ戻す。
3. WorkerがPython Runner app内部のauth moduleへ直接依存していた責務不整合 → `packages/runner-sdk`へ共有署名契約を移動。
4. SyntaxError / timeout等の提出コード起因failureが503となりinfra retryを誘発するコスト増幅リスク → terminal 0点へ分類し、基盤failureと分離。

#### このPRでは完了しない事項

- Actual AWS resource作成・変更。
- staging Remote Runner endpointのdeploy。
- Secrets Manager等によるshared secret配布・rotation。
- TLS / security group / task roleの実環境確認。
- adversarial staging test。
- 実インフラ上のquota / cost cap確認。
- PythonのPublic allowlist有効化。

Actual AWS変更はreview-only change setとユーザーの明示承認を経る。

#### 完了判定

PR #146の完了条件は「本番へ接続可能な安全なRemote Runner境界・test contract・CI検証をコードとして完成させる」まで。Issue #145自体はActual staging隔離検証とPython公開gate解除までOpenを維持する。

## Blocked Issue

### Python Challengeの公開提出可能化

- 状態: Blocked / Issue #145のstaging gate required。
- Python contentはcatalogへ存在しても「採点準備中」とする。
- Web / API / Workerの公開allowlistへPythonを追加しない。
- 再開条件:
  1. PR #146をmergeする。
  2. review-only IaCを作成・レビューする。
  3. 明示承認後にstaging Remote Runnerをdeployする。
  4. hidden filesystem / network / privilege / resource / timeout / orphan cleanupをstagingで再検証する。
  5. concurrency / quota / cost上限を確認する。
  6. adversarial code testを通す。

### ECS task definition / service wiring

- 状態: Blocked / DB移行依存あり。
- Admin Challenge async Repositoryまでは完了済み。
- Submission / lease / outbox Repository async移行、outbox claim / lease、RDS / secret / network IaC、data migration rehearsalが残る。

## Recently Completed

### #143 / PR #144（完了済み）

- 完了日: 2026-08-13（日本時間）。
- SQL / HTML-CSS固定Runner、Python isolated-preview、Runner contract共通化、Public Challenge 9件化をmainへ反映。

### #141 / PR #142（完了済み）

- 公開Challenge検索・絞り込み、JS/TS実践問題4件、TypeScript実採点、Submission target validationをmainへ反映。

### #139 / PR #140（完了済み）

- Admin Challenge Repositoryをasync DatabaseClientへ移行。

### #137 / PR #138（完了済み）

- PostgreSQL 18.4 / `pg` / migration executor / 実DB contractを導入。

## Follow-up候補

ユーザー価値:

1. Issue #145 staging隔離検証とPython公開gate。
2. Python Challenge追加。
3. Challenge tag検索 / 学習トラック。
4. おすすめChallenge / 次に解く問題。
5. 進捗ページの実データ化。

基盤依存:

1. Submission read / simple write async移行。
2. Processing lease / attempt fencing async移行。
3. Submission + outbox atomic transaction async移行。
4. API / Worker DB provider切替。
5. Outbox claim / lease。
6. RDS / Secrets Manager / network IaC。
7. Data migration / staging cutover rehearsal。

## Scale / safety gate

- PythonをActual staging検証前に公開しない。
- WorkerへDocker socketを公開しない。
- API processでsubmission codeを直接実行しない。
- Problem JSON由来commandを任意shellとして実行しない。
- Hidden testsをlearner向け公開境界へ返さない。
- ユーザーコード起因failureをinfra retryへ誤分類しない。
- Submission + outbox atomicityを弱めない。
- Processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
