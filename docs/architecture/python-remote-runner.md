# Python Remote Runner設計

最終更新: 2026-08-13（Issue #145 / PR #146）

## 目的

Python submissionをAPI / Worker processから分離した隔離環境で実行する。WorkerへDocker socketを公開せず、hidden test sourceをsubmitted codeからfilesystemレベルで分離する。

## スコープ

PR #146はRemote Runnerのアプリケーション境界とCI検証までを対象とする。Actual AWS resource作成、staging deploy、Python public allowlist有効化は対象外。

## コンポーネント

### Worker

- Python codeを直接実行しない。
- Docker commandを実行しない。
- `PYTHON_REMOTE_RUNNER_URL`へHTTP requestを送るだけ。
- ProductionではHTTPS以外を拒否する。
- shared secretは32文字以上。
- URLへcredential / query / fragmentを埋め込ませない。
- request timeoutとresponse sizeを有限化する。

### Runner SDK

`packages/runner-sdk/src/python-remote-auth.mjs`がWorker / Remote Runner共通のHMAC署名contractを持つ。

署名対象:

```text
timestamp\nidempotencyKey\nrequestBody
```

SHA-256 HMACをhexで送信し、Remote Runnerは`timingSafeEqual`で検証する。

### Python Remote Runner

`apps/python-runner`が専用HTTP serviceとして動作する。

Endpoints:

- `GET /health`
- `POST /v1/jobs`

`POST /v1/jobs`は次を検証する。

- request body上限。
- timestampの許容skew。
- idempotency key形式。
- HMAC署名。
- bodyのjobIdとheaderのidempotency key一致。
- challenge slug形式とpath containment。
- Python Challengeであること。

内部error、submitted code、secret、hidden testはresponseへ返さない。

## Hidden test filesystem isolation

### 旧方式

Python Challenge directoryのvisible / hidden `.py` testをcontainer workspaceへmountし、test processを直接実行するpreview方式だった。

この方式ではsubmitted codeが同一workspaceを探索すればhidden test fileを読めるため、本番公開条件を満たさない。

### PR #146方式

Challenge側のtest contractをJSON caseへ変更する。

Remote Runnerの信頼側Node processだけが次を読む。

- visible case。
- hidden case。
- expected value / expected error type。

Python sandboxへmountするのは次だけ。

```text
/workspace/submission.py
/workspace/invoke.py
```

`invoke.py`は汎用関数呼び出しharnessであり、Challenge固有の期待値を含まない。Node側からstdinで関数名・args・kwargsを送り、sandboxは実値または例外typeだけを返す。pass/fail判定は信頼側Node processが行う。

これによりsubmitted codeはhidden test source / expected valueをfilesystemから取得できない。

## Sandbox contract

固定image:

```text
python:3.14.5-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd
```

Docker option:

- `--network none`
- `--read-only`
- workspace read-only mount
- tmpfs `/tmp`だけwrite可能
- `--cap-drop ALL`
- `--security-opt no-new-privileges=true`
- UID/GID `65534:65534`
- CPU 0.5
- memory 256MiB
- pids 64
- nofile 64
- finite timeout
- stdout/stderr 256KiB cap
- shellを経由せず`python -I -B /workspace/invoke.py`

host側workspaceはcontainer実行時に0555、fileは0444とし、non-rootで読み取り可能かつ書き換え不能にする。cleanup前にdirectory permissionを0700へ戻す。

## Retry / idempotency

Remote Runnerはjob registryを持つ。

- 同一idempotency key + 同一payload: 実行中promiseまたは完了resultを再利用。
- 同一key + 異なるpayload: 409 conflict。
- infrastructure failure: cache entryを削除し再試行可能。
- result TTL: 既定10分。

現時点のregistryはprocess-localであり、複数Remote Runner instanceを跨ぐ強いdeduplicationは保証しない。ただしsandboxはnetwork disabled / read-onlyで外部副作用を持たず、Submissionの最終完了は既存attempt fencing / completion guardが正本となる。複数instance構成時の重複実行コストはstagingで評価する。

## Failure classification

ユーザーコード起因failureと実行基盤failureを分離する。

### Terminal grading failure

次はHTTP 503へせず、採点結果`completed / score 0`として返す。

- SyntaxErrorなどPython processの異常終了。
- submission runtime failure。
- timeout。
- sandbox protocolを壊す結果。

これらをinfra retryへ流さないことで、失敗submissionが既存retry回数分だけsandbox実行コストを増幅させることを防ぐ。

### Infrastructure failure

Docker processのspawn失敗、またはDocker自身がcontainer commandを開始できない種類の失敗だけをRemote Runner failureとして扱う。

実装ではDocker `run`の125 / 126 / 127を基盤側failureとして扱い、それ以外のcontainer command non-zeroはterminal grading failureへ分類する。

## Concurrency / quota

application-level既定値:

- max concurrency: 2
- max queued jobs: 8

上限超過は429 `runner_busy`。Worker側ではRemote Runner障害として既存infra retry契約へ接続する。

Actual AWS側のtask数 / autoscaling / budget / concurrency quotaはこのPRでは作らない。review-only IaCと明示承認後のstagingで決定する。

## Orphan cleanup

各containerへ`ai-code-dojo.python-runner=1` labelを付与する。

- 通常終了: `docker run --rm`。
- timeout: TERM / KILLに加えて`docker rm -f <container>`。
- service startup: label付き残存containerをcleanupする。

## Failure response contract

Remote Runnerはraw exceptionを外へ出さず、次のような一般化errorだけを返す。

- `unauthorized`
- `invalid_payload`
- `runner_busy`
- `idempotency_conflict`
- `runner_execution_failed`

Worker clientもraw response bodyやsubmitted codeをerror textへ含めない。

## CI contract

GitHub Actions integration jobで実Docker imageをpullし、以下を確認する。

1. starterは100点にならない。
2. reference solutionはvisible / hidden全case成功。
3. malicious submissionが`/workspace`を走査してもhidden/test/case fileを検出できない。
4. Worker client → HTTP Remote Runner → actual Docker → Python sandboxで100点になる。
5. HMAC不正は401。
6. 同一idempotency keyのpayload差し替えは409。
7. SyntaxErrorはterminal 0点になる。
8. timeoutはterminal 0点になる。
9. 既存PostgreSQL integration、lease / fencing / retry系を壊さない。

head `41517264580678372428b8d3df0d4b0e9dff0699`で上記を含むapp-quality全jobとdocs-validationがSuccess。

## Production公開gate

Pythonを公開allowlistへ追加するにはPR #146 mergeだけでは不足する。

必須:

1. review-only IaCを作成する。
2. Workerとは別のRemote Runner runtimeを用意する。
3. secretを安全に配布・rotation可能にする。
4. TLS / network policyを確認する。
5. adversarial codeをstagingで実行する。
6. resource / timeout / orphan cleanupを実環境で確認する。
7. quota / concurrency / cost上限を確認する。
8. rollback手順を確認する。
9. 明示承認後にのみPython public gateを変更する。

## 非対象

- API processでのPython実行。
- Worker Docker socket mount。
- arbitrary shell command execution。
- DB / queue transport cutover。
- RDS / ECS Actual resource作成。
