# active-issues（正本）

最終更新: 2026-08-10（Issue #141 / PR #142 公開Challenge catalog拡充をレビュー可能状態へ整備）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #141 公開Challengeの検索・絞り込みとJS/TS実践問題を追加する

- 優先度: P2
- 状態: Open / PR #142 Ready for review / mergeable
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/141`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/142`
- Branch: `feat/challenge-catalog-expansion`
- Linear: 無料Issue上限により作成不可。GitHub Issue / Repository docs / Notionを管理正本とする。

#### 目的

公開Challengeを3件から増やし、学習者がkeyword / difficulty / category / languageで問題を探せるようにする。現行Node系runnerで実際に採点できるJavaScript / TypeScript実践問題を追加する。

#### 実装済み

- File-backed Challenge 3件 → 7件。
- title / slug keyword filter。
- difficulty / category / language filter。
- GET query stringによる条件保持。
- 0件表示 / `filtered / total`件数表示。
- 不正・未知filter値のfail-safe。
- JavaScript実践Challenge 2件。
- TypeScript実践Challenge 2件。
- visible / hidden test分離。
- starter failure / reference solution successのcontent contract integration test。
- 問題詳細の`metadata.category`表示修正。
- HTML attribute escape強化。
- JS / TS runner language policyを`runner-sdk`へ共通化。
- Web / API / Workerで共通runner allowlistを利用。
- APIでChallenge存在・slug・languageをsubmission永続化前に検証。
- Workerでもlegacy / internal queue経路を同じpolicyでfail-closed。
- TypeScriptをAPI → queue → Worker → visible / hidden testまでE2E確認。
- SQL等の採点未対応Challengeを一覧 / 詳細 / Web POST / API / Workerでfail-closed。
- Submission APIの非2xx / 通信失敗 / id欠落をWebで安全に表示し、`/submissions/undefined`への遷移を防止。

#### 追加Challenge

- `js-refactor-order-summary`: medium / refactor
- `js-bugfix-pagination-window`: hard / bugfix
- `ts-feature-access-policy`: medium / feature
- `ts-refactor-feature-flags`: hard / refactor

#### 言語gate

- JavaScript: 提出可能。
- TypeScript: Node 22.23.1で実API → Worker E2E成功、提出可能。
- SQL: 既存ProblemはPython / SQLite command前提だが現行Node系runnerはそのcommandを実行しないため採点準備中。
- Python / HTML-CSS: Runner未実装。

SQL / Python / HTML-CSS RunnerはIssue #143へ分離する。

#### 実装中に検出・修正した問題

1. 親Node test runnerの`NODE_TEST_CONTEXT`が子`node --test`へ継承され、Challenge testが再帰実行としてskipされexit 0になる検証ハーネス不具合を修正。
2. 既存SQL Challengeがschema-validでも現行Workerでは採点不能である不整合を確認し、fail-closed化。
3. Workerが`language !== 'javascript'`を固定拒否していたため、共通policyへ変更しTypeScript E2Eを追加。
4. Webだけの言語guardは直接API呼び出しで迂回できたため、APIでChallenge存在・対応言語・runner allowlistを永続化前に検証。
5. 旧infra failure integrationが存在しないChallengeのPublic API作成に依存していたため、内部Repository fixture + 正規queue messageへ変更。
6. 自動レビューP1で、既存`ts-feature-user-display`が拡張子なしimportにより`ERR_MODULE_NOT_FOUND`となり得る問題を検出。`.ts`拡張子を明示し、Problem statementとtest契約も整合させた。
7. 自動レビューP2で、Submission APIの400/404時にWebが`/submissions/undefined`へredirectする問題を検出。API response clientを追加し、非2xx時はエラー表示してredirectしないよう修正した。

#### レビュー対応

- Codex Review: 1回実施。
- P1: 既存TypeScript Challengeの実行契約不整合 → 修正済み。
- P2: Submission検証エラーのWeb表示漏れ → 修正済み。
- `ts-feature-user-display`をcontent contractへ追加し、starter failure / reference solution successを確認。
- `ts-feature-user-display`専用のAPI → queue → Worker E2Eを追加。
- Submission API 400時のWeb実HTTP integration testを追加し、400表示・Locationなし・`/submissions/undefined`非出現を確認。
- 2件のinline review threadへ修正内容を返信し、両方resolve済み。
- 未解決inline review thread: 0件。

#### 最終確認結果

レビュー修正後のcode headで以下が成功済み。

- Docs validation: Success
- Frozen lockfile install: Success
- Lint: Success
- Typecheck: Success
- Unit test: Success
- Integration test: Success
- TypeScript API → Worker E2E: Success
- 既存`ts-feature-user-display` API → Worker E2E: Success
- Submission API error → Web error表示 integration: Success
- Schema validation: Success
- Infra validation: Success
- Build: Success
- PR: Ready for review / mergeable
- Inline review thread: 0件

#### 完了条件

- File-backed Challengeが3件から7件へ増える。
- 追加4問のstarterが最初から全testを通らない。
- reference solutionでvisible / hidden testをすべて通過する。
- keyword / difficulty / category / languageで絞り込める。
- filter条件がURL queryに保持される。
- 未知filter値を500にしない。
- 採点未対応言語を対応済みfilter候補にしない。
- 採点未対応ChallengeからWeb / API経由でsubmissionを作成できない。
- TypeScriptを実Worker経路で採点できる。
- Submission APIのvalidation errorをWebで正しく表示できる。
- hidden test sourceをlearnerへ露出しない。
- Submission + outbox atomicity / lease / fencing / completion guardを変更しない。
- Production runtimeをSQLite / HTTPのまま維持する。
- 全品質ゲートが成功する。

### #143 SQL・Python・HTML/CSS向け言語別Runner contractを導入する

- 優先度: P2
- 状態: Open / #141後続
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/143`
- Linear: 無料Issue上限のためGitHubを正本とする。

#### 目的

Problem schemaの対応言語とWorkerの実行能力を一致させ、SQL / Python / HTML-CSS Challengeを安全に提出可能にする。

#### 必須境界

- Problem JSON由来の`testCommand`を任意shell commandとして直接実行しない。
- language / runner typeをallowlistして固定runnerへdispatchする。
- unsupported languageを実行前にfail-closed拒否する。
- timeout / network disabled / resource isolationを維持する。
- API processでsubmission codeを直接実行しない。
- hidden testsをlearnerへ返さない。

## Blocked Issue

### SQL / Python / HTML-CSS Challengeの提出可能化

- 状態: Blocked / Issue #143 required
- 再開条件:
  1. 言語別Runner contractを実装する。
  2. toolchain / image versionを固定する。
  3. isolation / timeout / network disabledを維持する。
  4. 実Challengeでstarter failure / reference solution successを確認する。
  5. learner向けUIへ対応言語として追加する。

### ECS task definition / service wiring

- 状態: Blocked / Implementation dependencies required
- 再開条件:
  1. DB adapter contract: PR #134で完了
  2. Versioned schema / SQLite runner: PR #136で完了
  3. 実PostgreSQL test / executor: PR #138で完了
  4. Admin Challenge Repository async化: PR #140で完了
  5. Submission / lease / outbox Repository async移行
  6. Outbox claim / lease
  7. RDS / secret / network IaC
  8. Data migration tool / staging rehearsal

## Recently Completed

### #139 / PR #140（完了済み）

- 完了日: 2026-08-10（日本時間）
- 反映内容: Admin Challenge Repositoryをasync DatabaseClientへ移行し、Challenge create / version appendのatomicityとPostgreSQL同時Version採番を保証した。

### #137 / PR #138（完了済み）

- 完了日: 2026-08-07（日本時間）
- 反映内容: PostgreSQL 18.4、`pg` driver、実PostgreSQL migration executor、DatabaseClient実DB contractを実装した。

### #135 / PR #136（完了済み）

- 完了日: 2026-08-06（日本時間）
- 反映内容: Versioned migration manifest、provider別schema、checksum / drift検出、SQLite runner、有限busy timeoutを実装した。

## Follow-up Issue Candidates

ユーザー価値:

1. Issue #143 SQL / Python / HTML-CSS言語別Runner（P2）
2. Challenge tag検索 / 学習トラック（P2）
3. おすすめChallenge / 次に解く問題（P2）
4. 進捗ページの実データ化（P2）

基盤依存:

1. Submission read / simple writeのasync移行（P2）
2. Submission processing lease / attempt fencingのasync移行（P2）
3. Submission + queue outbox atomic transactionのasync移行（P2）
4. API / Worker composition rootのprovider切替（P2）
5. Outbox claim / leaseと複数API instance安全化（P2）
6. RDS PostgreSQL / Secrets Manager / security group IaC（P2）
7. SQLite export / PostgreSQL import / validation tool（P2）
8. API / Worker / Migrator ECS wiring（P2）
9. Staging cutover rehearsal / rollback drill（P2）
10. Public ChallengeをDB-backed管理へ統合するかの設計（P2）

## Scale / safety gate

- Runner未実装言語を公開catalogで対応済みとして表示しない。
- Web / API / Workerでrunner allowlistを分散定義しない。
- 採点未対応languageをsubmission / outboxへ永続化しない。
- Problem JSON由来commandを任意shellとして実行しない。
- Hidden testsをlearner向け公開境界へ返さない。
- API processでsubmission codeを直接実行しない。
- Challenge Versionは既存rowを上書きせず新versionとして追加する。
- Submission + outbox atomicityをRepository移行で弱めない。
- Processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease完了前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Application roleへDDL権限を付与しない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
