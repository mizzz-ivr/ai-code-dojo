# active-issues（正本）

最終更新: 2026-08-10（Issue #141 / PR #142 公開Challenge catalog拡充を実装）

## この文書の目的

進行中・未解決課題を、優先順位と依存関係付きで管理する。

## 優先度定義

- P0: セキュリティ・可用性・法令順守を阻害
- P1: 直近スプリントで解決すべき重要課題
- P2: 改善課題（計画的に対応）

## 進行中Issue

### #141 公開Challengeの検索・絞り込みとJS/TS実践問題を追加する

- 優先度: P2
- 状態: Open / PR #142 Draft
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/141`
- GitHub PR: `https://github.com/mizzz-ivr/ai-code-dojo/pull/142`
- Branch: `feat/challenge-catalog-expansion`
- Linear: 無料Issue上限により作成不可。GitHub Issue / Repository docs / Notionを管理正本とする。

#### 目的

公開Challengeを3件から増やし、学習者がkeyword / difficulty / category / languageで問題を探せるようにする。現行Workerで実際に採点できるJS/TS実践問題を追加する。

#### 対象

- title / slug keyword filter
- difficulty / category / language filter
- GET query stringによる条件保持
- 0件表示 / 件数表示
- 不正・未知filter値のfail-safe
- JavaScript実践Challenge 2件
- TypeScript実践Challenge 2件
- visible / hidden test分離
- starter failure / reference solution successのcontent contract integration test
- 問題詳細の`metadata.category`表示修正
- HTML attribute escape強化
- 採点未対応Challengeの一覧 / 詳細 / POST提出fail-closed
- architecture / log / prompt / handoff / canonical docs

#### 追加Challenge

- `js-refactor-order-summary`: medium / refactor
- `js-bugfix-pagination-window`: hard / bugfix
- `ts-feature-access-policy`: medium / feature
- `ts-refactor-feature-flags`: hard / refactor

#### 言語gate

実行経路確認により、現行Workerで採点確認済みなのはJavaScript / TypeScript。

- JavaScript: 提出可能
- TypeScript: Node 22.23.1で実Challenge contract成功、提出可能
- SQL: 既存ProblemはPython / SQLite command前提だがWorkerは`node --test`固定のため採点準備中
- Python / HTML-CSS: Runner未実装

PR #142ではJavaScript / TypeScript以外をWebからAPIへ提出しない。SQL / Python / HTML-CSS RunnerはIssue #143へ分離する。

#### 初回CIで見つかった問題

`challenge-content-contract.test.mjs`から子`node --test`を実行した際、親のNode test runner内部変数`NODE_TEST_CONTEXT`が継承され、再帰testとして全fileがskipされexit 0になる問題を検出した。

子processのenvから`NODE_TEST_CONTEXT`だけを除外し、実Runner相当の独立processでChallenge testを実行するよう修正した。修正後のcode headではlint / typecheck / unit / integration / schema / infra / buildが成功済み。

#### 完了条件

- File-backed Challengeが3件から7件へ増える。
- 追加4問のstarterが最初から全testを通らない。
- reference solutionでvisible / hidden testをすべて通過する。
- keyword / difficulty / category / languageで絞り込める。
- filter条件がURL queryに保持される。
- 未知filter値を500にしない。
- 採点未対応言語を対応済みfilter候補にしない。
- 採点未対応Challengeから提出できない。
- hidden test sourceをlearnerへ露出しない。
- Production runtimeをSQLite / HTTPのまま維持する。
- 全品質ゲートが成功する。

### #143 SQL・Python・HTML/CSS向け言語別Runner contractを導入する

- 優先度: P2
- 状態: Open / #141後続
- GitHub Issue: `https://github.com/mizzz-ivr/ai-code-dojo/issues/143`
- Linear: #141と同じ無料Issue上限のためGitHubを正本とする。

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
- 採点未対応languageをWebからAPIへforwardしない。
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
