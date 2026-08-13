# Issue #145 Python Remote Runner handoff

日付: 2026-08-13

## 現在地

- Branch: `feat/python-remote-isolation-runner`
- PR: #146 `Python Remote Runner境界とhidden test隔離を導入`
- Issue: #145 Openのまま維持する。
- Python Public submission: OFF / 400 fail-closed。
- Production DB / queue: SQLite / HTTPのまま。
- Actual AWS変更: 未実施。

## PR #146で完成させるもの

- WorkerとPython実行環境のservice分離。
- WorkerからPython Docker実行コードを削除。
- HMAC署名付きRemote Runner client。
- Python専用Remote Runner HTTP service。
- pinned image / resource isolation。
- hidden test filesystem isolation。
- JSON case + trusted comparator。
- application-level idempotency / concurrency / queue上限。
- timeout / orphan cleanup境界。
- actual Docker / HTTP integration test。

## 維持する不変条件

- API processはsubmission codeを実行しない。
- WorkerへDocker socketを公開しない。
- hidden test sourceをlearnerへ返さない。
- Problem JSON由来commandを任意shellとして実行しない。
- Submission + outbox atomicityを変更しない。
- processing lease / attempt fencing / completion guardを変更しない。
- Pythonをstaging gate前に公開しない。
- Actual AWS変更はreview-only + 明示承認。

## 次に確認すること

1. 最新headのapp-qualityが全成功すること。
2. PR diff自己レビューでWorker側に`docker`実行が残っていないこと。
3. hidden JSON caseがsandbox mount対象でないこと。
4. PR review thread / commentsを確認すること。
5. PRをReady for reviewへ移すこと。
6. Issue #145 / NotionへPR #146状態を同期すること。

## PR #146 merge後の次タスク

Issue #145をcloseせず、review-only AWS / staging設計を別PRで進める。

推奨スコープ:

- Remote Runner用の独立runtime設計。
- TLS endpoint。
- Secrets Manager等のshared secret管理。
- WorkerからRemote Runnerだけを許可するnetwork policy。
- 最小task role。
- desired/max task数とconcurrency / cost cap。
- staging deploy change set。
- adversarial test runbook。
- rollback手順。

Actual resourceの作成・Change Set executeはユーザーの明示承認前に行わない。

## Python公開gate解除後のユーザー価値タスク

- Python Challengeを3〜5問追加。
- Python language filterを公開。
- Python学習トラックを追加。
- おすすめChallengeへPythonを組み込む。
