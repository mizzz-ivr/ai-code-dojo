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
- architecture / log / prompt / handoff / canonical docs

#### 追加Challenge

- `js-refactor-order-summary`: medium / refactor
- `js-bugfix-pagination-window`: hard / bugfix
- `ts-feature-access-policy`: medium / feature
- `ts-refactor-feature-flags`: hard / refactor

#### 非対象

- Python / HTML-CSS Challenge追加
- Python / HTML-CSS Runner
- Public Challenge DB-backed化
- Admin/Public datasource統合
- Submission / lease / outbox変更
- Production runtime変更

#### 言語gate

Problem schemaはPython / HTML-CSSも予約しているが、現行Worker isolation runnerはNode test runner前提。Runnerと実行契約テストがない言語を公開UIで「対応済み」にしない。

現行公開catalogのlanguage候補:

- javascript
- typescript
- sql

#### 初回CIで見つかった問題

`challenge-content-contract.test.mjs`から子`node --test`を実行した際、親のNode test runner内部変数`NODE_TEST_CONTEXT`が継承され、再帰testとして全fileがskipされexit 0になる問題を検出した。

子processのenvから`NODE_TEST_CONTEXT`だけを除外し、実Runner相当の独立processでChallenge testを実行するよう修正した。修正後のcode headではlint / typecheck / unit / integration / schema / infra / buildが成功済み。

#### 完了条件

- 公開Challengeが3件から7件へ増える。
- 追加4問のstarterが最初から全testを通らない。
- reference solutionでvisible / hidden testをすべて通過する。
- keyword / difficulty / category / languageで絞り込める。
- filter条件がURL queryに保持される。
- 未知filter値を500にしない。
- Python / HTML-CSSを対応済み言語として表示しない。
- hidden test sourceをlearnerへ露出しない。
- Production runtimeをSQLite / HTTPのまま維持する。
- 全品質ゲートが成功する。

## Blocked Issue

### Python / HTML-CSS Challenge公開

- 状態: Blocked / Runner dependency required
- 理由: Problem schema上は定義可能だが、現行WorkerはNode test runner前提。
- 再開条件:
  1. 言語別Runner contractを定義する。
  2. isolation / timeout / network disabledを維持する。
  3. 実Challengeでstarter failure / reference solution successを確認する。
  4. learner向けUIへ対応言語として表示する。

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

### #133 / PR #134（完了済み）

- 完了日: 2026-08-05（日本時間）
- 反映内容: Async DatabaseClient contract、SQLite adapter、PostgreSQL provider境界、共通contract testを実装した。

## Follow-up Issue Candidates

ユーザー価値:

1. Python Runner + Python Challenge（P2）
2. Challenge tag検索 / 学習トラック（P2）
3. おすすめChallenge / 次に解く問題（P2）
4. 進捗ページの実データ化（P2）
5. HTML/CSS評価Runner + Frontend Challenge（P2）

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
- Hidden testsをlearner向け公開境界へ返さない。
- API processでsubmission codeを直接実行しない。
- Challenge Versionは既存rowを上書きせず新versionとして追加する。
- Submission + outbox atomicityをRepository移行で弱めない。
- Processing lease / attempt fencing / completion guardを弱めない。
- Outbox claim / lease完了前にAPI desired countを1より増やさない。
- DB cutoverとSQS transport切替を同じchangeへ含めない。
- Application roleへDDL権限を付与しない。
- Actual AWS resourceはreview-only change setと明示承認を経る。
