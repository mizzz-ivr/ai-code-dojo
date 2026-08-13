# Issue #145 Python Remote Runner 実装ログ

日付: 2026-08-13

## 対象

- Issue #145: Python Runnerの本番隔離実行基盤を導入する
- PR #146: Python Remote Runner境界とhidden test隔離を導入
- Branch: `feat/python-remote-isolation-runner`

## 実施内容

1. PR #144がmainへmerge済みであることを確認。
2. `apps/python-runner`専用Remote Runner serviceを追加。
3. WorkerのPython Docker Runnerを削除し、署名付きHTTP clientへ置換。
4. HMAC共有契約を`packages/runner-sdk`へ分離。
5. Python Challenge testを`.py`直接実行からJSON case + trusted comparatorへ変更。
6. sandboxへhidden test / expected valueをmountしない構成へ変更。
7. idempotency / concurrency / queue / size / timeout上限を追加。
8. timeout時強制container削除 / orphan cleanup境界を追加。
9. 実HTTP Remote Runner + actual Docker integration testを追加。

## 初回CIで検出した問題

### Unit testのJSON文字列比較

request bodyはJSON.stringifyにより改行がescapeされるため、literal multiline codeがbody文字列に直接含まれるという期待値は誤りだった。

修正:

- request bodyをJSON.parseする。
- parsed `code`が元codeと一致することを検証する。

### non-root workspace読取失敗

`mkdtemp`は0700 directoryを作る。sandboxはUID/GID 65534で実行するため、0444 fileでも親directoryをtraverseできずPython processが失敗した。

修正:

- fileは0444。
- container実行中だけworkspace directoryを0555。
- cleanup前に0700へ戻す。
- read-only mount / non-root制約は維持。

修正後head `1cc2b3796c7259d81962b5ad00bbee6918d95576`でunit / integration成功を確認。

## 自己レビューで追加修正

Workerが`apps/python-runner/src/auth.mjs`へ直接依存しており、app間の責務境界が崩れていた。

修正:

- HMAC署名contractを`packages/runner-sdk/src/python-remote-auth.mjs`へ移動。
- Worker / Remote Runner / testsは共有SDKを参照する。

## セキュリティ確認

- APIでsubmitted codeを実行しない。
- WorkerにPython Docker実行コードを残さない。
- Docker socketをWorkerへ渡さない。
- Problem JSON由来commandをshell実行しない。
- Python image digest固定。
- network disabled。
- root filesystem / workspace read-only。
- non-root。
- capability drop ALL。
- no-new-privileges。
- CPU / memory / pids / fd / timeout有限。
- stdout/stderr上限。
- hidden source / expected valueをsandbox filesystemへ配置しない。
- HMACでrequest tamperを検出。
- Production HTTP endpointを拒否。
- raw secret / submitted code / hidden testをerror responseへ含めない。

## 残課題

- Actual AWS / staging deploy。
- Secret distribution / rotation。
- TLS / network / IAM review-only IaC。
- adversarial staging test。
- infra-level quota / budget / autoscaling。
- process-local idempotencyの複数instance時評価。
- Python public allowlist有効化。

Issue #145は上記staging gate完了までOpenを維持する。
