# Issue #153 実装ログ — Python Runner staging change set review

日付: 2026-08-19

## 目的

PR #152のimmutable release manifestから、任意image URI入力なしでPython Runner staging CloudFormation change setをreview-only生成する。

## 実装

- GitHub Issue #153作成。LinearはFree workspace Issue上限のため作成不可。
- Branch: `feat/python-runner-staging-change-set`。
- Draft PR #154作成。
- review-only OIDC role CloudFormationを追加。
- release workflow run / artifact identity検証を追加。
- manifest checksum / schema / main ancestry gateを追加。
- deterministic staging parameter generatorを追加。
- manual review-only change set workflowを追加。
- `ExecuteChangeSet` / direct deploy系actionをvalidatorで拒否。
- unit test / infra validationへ統合。

## 初回CIで検出した事項

初回headではlint / typecheck / schemaはSuccessしたが、unit / infraが1件の同一contract不整合でFailure。

原因:

- workflowはpublish run `head_sha`由来のexact artifact nameを使用していた。
- validatorだけが設計途中のwildcard `pattern: python-runner-image-release-*`を要求していた。

修正:

workflowを弱めてwildcardへ戻さず、validatorを次のactual contractへ合わせた。

- `artifact_name="python-runner-image-release-${release_head_sha}"`
- selected run artifacts APIを確認
- exact name + `expired=false`
- exact artifact nameを`actions/download-artifact`へ渡す

## 自己レビューで明示した非対象

Repository内validationだけでは実AWS topologyの次は証明できない。

- subnetがprivateであること
- 2 AZ以上に分散していること
- hosted zone / VPC association
- ACM SAN/CNとRunnerDnsName一致
- actual routing / egress

これらはActual execute前のread-only preflight /手動確認としてrunbookへ明記した。権限拡大をこのPRへ混ぜない。

## Actual AWS変更

未実施。

- review role作成なし
- change set作成なし
- change set executeなし
- staging deployなし
- image publishなし
- Python Public gate変更なし
