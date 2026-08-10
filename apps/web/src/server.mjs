import http from 'node:http';
import { readWebSession, buildWebSessionCookie, clearWebSessionCookie } from './auth.mjs';
import {
  CHALLENGE_CATALOG_OPTIONS,
  filterChallenges,
  readChallengeCatalogFilters
} from './challenge-catalog.mjs';

const port = Number(process.env.WEB_PORT ?? 3000);
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAUTHORIZED = 401;
const LOGIN_INVALID_MESSAGE = '認証に失敗しました。ユーザー名またはパスワードを確認してください。';
const LOGIN_API_UNAVAILABLE_MESSAGE = '認証サービスに接続できませんでした。時間をおいて再試行してください。';

const sendHtml = (res, statusCode, html) => {
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
};

const parseFormBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const redirect = (res, location) => { res.writeHead(302, { location }); res.end(); };
const renderLoginPage = (errorMessage = '') => renderLayout({
  title: 'ログイン',
  activePath: '/',
  content: `<section class="card"><h1>ログイン</h1><form method="POST" action="/login"><p><label>username<br><input name="username" type="text" value="learner" /></label></p><p><label>password<br><input name="password" type="password" value="" /></label></p><button class="cta" type="submit">ログイン</button></form>${errorMessage ? `<p class="fail">${escapeHtml(errorMessage)}</p>` : ''}<p class="muted">環境変数で設定された認証情報を入力してください。</p></section>`
});
const requireAdminPage = (req, res) => {
  const user = readWebSession(req);
  if (!user) { redirect(res, '/login?next=/admin/challenges'); return null; }
  if (user.role !== 'admin') {
    return sendHtml(res, 403, renderLayout({ title: '権限エラー', activePath: '/', content: renderStateCard('fail', 'admin権限が必要です。') }));
  }
  return user;
};
const apiHeadersFor = (req) => {
  const user = readWebSession(req);
  if (!user) return {};
  const token = `${user.username}:${user.password}`;
  return { 'x-web-user': token };
};

const navLinks = [
  ['/', '問題一覧'],
  ['/progress', '進捗'],
  ['/dashboard', 'ダッシュボード'],
  ['/admin/challenges', '管理画面']
];

const renderLayout = ({ title, activePath, content, admin = false }) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | AI Code Dojo</title>
<style>
  :root { color-scheme: light; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${admin ? '#f3f4f6' : '#f6f8ff'}; color: #1f2430; margin: 0; }
  .app { max-width: 1080px; margin: 0 auto; padding: 16px; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .brand { font-weight: 700; font-size: 20px; }
  .nav { display: flex; gap: 8px; flex-wrap: wrap; }
  .nav a { text-decoration: none; color: #344054; border: 1px solid #d0d5dd; border-radius: 999px; padding: 6px 12px; font-size: 14px; }
  .nav a.active { background: ${admin ? '#111827' : '#2656f6'}; border-color: ${admin ? '#111827' : '#2656f6'}; color: #fff; }
  .card { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .muted { color: #667085; }
  .cta { display: inline-block; background: ${admin ? '#1f2937' : '#2656f6'}; color: white; padding: 8px 12px; border-radius: 8px; text-decoration: none; border: 0; cursor: pointer; }
  .danger { background: #b42318; }
  .secondary { background: #fff; color: #344054; border: 1px solid #d0d5dd; }
  .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; margin-right: 6px; }
  .ok { background: #e7f8ee; color: #067647; }
  .warn { background: #fff4e6; color: #b54708; }
  .fail { background: #fee4e2; color: #b42318; }
  .admin-tag { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #4b5563; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; border-bottom: 1px solid #eaecf0; padding: 10px 8px; vertical-align: top; }
  textarea { width: 100%; min-height: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  input[type="text"], select { box-sizing: border-box; width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #d0d5dd; background: #fff; }
  pre { background: #f8fafc; border: 1px solid #e4e7ec; border-radius: 8px; padding: 12px; overflow: auto; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .filters { display: grid; grid-template-columns: minmax(220px, 2fr) repeat(3, minmax(140px, 1fr)); gap: 12px; margin: 16px 0 12px; align-items: end; }
  .filter-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; }
  .filter-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .table-wrap { overflow-x: auto; }
  @media (max-width: 760px) { .filters { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <main class="app">
    <header class="header">
      <div>
        <div class="brand">AI Code Dojo</div>
        ${admin ? '<div class="admin-tag">Admin Console</div>' : ''}
      </div>
      <nav class="nav">${navLinks.map(([href, label]) => `<a class="${href === activePath ? 'active' : ''}" href="${href}">${label}</a>`).join('')}</nav>
    </header>
    ${content}
  </main>
</body>
</html>`;

const renderStateCard = (state, message) => `<section class="card"><span class="badge ${state}">${state}</span><p>${escapeHtml(message)}</p></section>`;

const safeJsonParse = (raw, fallback) => {
  try { return JSON.parse(raw); } catch { return fallback; }
};

const renderFilterOptions = (values, selectedValue) => [
  '<option value="">すべて</option>',
  ...values.map((value) => `<option value="${escapeHtml(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(value)}</option>`)
].join('');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/login') {
    return sendHtml(res, 200, renderLoginPage());
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    const form = await parseFormBody(req);
    const username = String(form.get('username') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      const loginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!loginResponse.ok) return sendHtml(res, HTTP_UNAUTHORIZED, renderLoginPage(LOGIN_INVALID_MESSAGE));
      const data = await loginResponse.json();
      const role = data?.user?.role === 'admin' ? 'admin' : 'learner';
      const session = { username, password, role };
      res.setHeader('Set-Cookie', buildWebSessionCookie(session));
      return redirect(res, role === 'admin' ? '/admin/challenges' : '/');
    } catch {
      return sendHtml(res, HTTP_BAD_GATEWAY, renderLoginPage(LOGIN_API_UNAVAILABLE_MESSAGE));
    }
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    res.setHeader('Set-Cookie', clearWebSessionCookie());
    return redirect(res, '/login');
  }

  if (req.method === 'GET' && url.pathname === '/admin/challenges') {
    if (!requireAdminPage(req, res)) return;
    const response = await fetch(`${apiBaseUrl}/api/admin/challenges`, { headers: apiHeadersFor(req) });
    const data = await response.json();
    const challenges = Array.isArray(data?.challenges) ? data.challenges : [];
    const rows = challenges.map((item) => `<tr><td><strong>${escapeHtml(item.slug)}</strong><br><span class="muted">${escapeHtml(item.id)}</span></td><td><span class="badge ${item.status === 'published' ? 'ok' : 'warn'}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.updatedAt ?? item.createdAt ?? '-')}</td><td><a class="cta secondary" href="/admin/challenges/${encodeURIComponent(item.id)}">編集</a></td></tr>`).join('');
    return sendHtml(res, 200, renderLayout({
      title: '管理一覧',
      activePath: '/admin/challenges',
      admin: true,
      content: `<section class="card"><h1>管理一覧</h1><p class="muted">学習者向けUIとは分離した運用画面です。公開状態・バージョン管理・危険操作をここから実行します。</p><table><tr><th>Challenge</th><th>状態</th><th>更新日時</th><th></th></tr>${rows || '<tr><td colspan="4" class="muted">登録された challenge がありません。</td></tr>'}</table></section>`
    }));
  }

  if (req.method === 'GET' && url.pathname.startsWith('/admin/challenges/')) {
    if (!requireAdminPage(req, res)) return;
    const id = decodeURIComponent(url.pathname.replace('/admin/challenges/', ''));
    const response = await fetch(`${apiBaseUrl}/api/admin/challenges/${id}`, { headers: apiHeadersFor(req) });
    if (response.status === 404) {
      return sendHtml(res, 404, renderLayout({ title: '管理編集', activePath: '/admin/challenges', admin: true, content: renderStateCard('warn', 'challengeが見つかりません。') }));
    }
    const data = await response.json();
    const challenge = data.challenge;
    const currentVersion = challenge.versions?.[0];
    const versionRows = (challenge.versions ?? []).map((v) => `<tr><td>v${v.version}</td><td>${escapeHtml(v.createdAt)}</td><td>${v.id === challenge.currentVersionId ? '<span class="badge ok">current</span>' : ''}</td></tr>`).join('');

    return sendHtml(res, 200, renderLayout({
      title: `管理編集: ${challenge.slug}`,
      activePath: '/admin/challenges',
      admin: true,
      content: `<section class="card"><h1>${escapeHtml(challenge.slug)}</h1><p><span class="badge ${challenge.status === 'published' ? 'ok' : 'warn'}">${escapeHtml(challenge.status)}</span> <span class="muted">ID: ${escapeHtml(challenge.id)}</span></p><div class="actions"><form method="POST" action="/admin/challenges/${escapeHtml(challenge.id)}/publish"><input type="hidden" name="status" value="published" /><button class="cta" type="submit">Publish</button></form><form method="POST" action="/admin/challenges/${escapeHtml(challenge.id)}/publish"><input type="hidden" name="status" value="draft" /><button class="cta danger" type="submit">Unpublish (draft化)</button></form></div><p class="muted">※ Unpublish は学習者公開を止める危険操作です。実行前に影響範囲を確認してください。</p></section>
      <section class="card"><h2>Version 管理</h2><table><tr><th>Version</th><th>作成日時</th><th>状態</th></tr>${versionRows}</table></section>
      <section class="card"><h2>問題編集（新規version追加）</h2><p class="muted">既存versionは上書きせず、新規versionとして保存します。</p>
      <form method="POST" action="/admin/challenges/${escapeHtml(challenge.id)}/versions">
        <p><label>metadata.title<br><input type="text" name="title" value="${escapeHtml(currentVersion?.metadata?.title ?? '')}" /></label></p>
        <p><label>hiddenTests (JSON)<br><textarea name="hiddenTests">${escapeHtml(JSON.stringify(currentVersion?.hiddenTests ?? [], null, 2))}</textarea></label></p>
        <p><label>reviewConfig (JSON)<br><textarea name="reviewConfig">${escapeHtml(JSON.stringify(currentVersion?.reviewConfig ?? {}, null, 2))}</textarea></label></p>
        <button class="cta" type="submit">新規versionを保存</button>
      </form>
      </section>
      <section class="card"><h2>運用メモ</h2><ul><li>hidden tests は学習者向けUI/APIへ露出しません。</li><li>reviewConfig変更時はreview-preview表示崩れを確認してください。</li></ul></section>`
    }));
  }

  if (req.method === 'POST' && url.pathname.endsWith('/publish') && url.pathname.startsWith('/admin/challenges/')) {
    if (!requireAdminPage(req, res)) return;
    const id = url.pathname.replace('/admin/challenges/', '').replace('/publish', '');
    const form = await parseFormBody(req);
    await fetch(`${apiBaseUrl}/api/admin/challenges/${id}/publish`, { method: 'PATCH', headers: { ...apiHeadersFor(req), 'content-type': 'application/json' }, body: JSON.stringify({ status: form.get('status') }) });
    res.writeHead(302, { location: `/admin/challenges/${id}` });
    return res.end();
  }

  if (req.method === 'POST' && url.pathname.endsWith('/versions') && url.pathname.startsWith('/admin/challenges/')) {
    if (!requireAdminPage(req, res)) return;
    const id = url.pathname.replace('/admin/challenges/', '').replace('/versions', '');
    const form = await parseFormBody(req);
    const detailRes = await fetch(`${apiBaseUrl}/api/admin/challenges/${id}`, { headers: apiHeadersFor(req) });
    const data = await detailRes.json();
    const base = data.challenge.versions?.[0] ?? {};
    const versionData = {
      ...base,
      metadata: { ...(base.metadata ?? {}), title: form.get('title') || base.metadata?.title || 'untitled' },
      hiddenTests: safeJsonParse(form.get('hiddenTests') ?? '[]', base.hiddenTests ?? []),
      reviewConfig: safeJsonParse(form.get('reviewConfig') ?? '{}', base.reviewConfig ?? {}),
      createdAt: undefined,
      id: undefined,
      version: undefined
    };
    await fetch(`${apiBaseUrl}/api/admin/challenges/${id}/versions`, { method: 'POST', headers: { ...apiHeadersFor(req), 'content-type': 'application/json' }, body: JSON.stringify({ versionData }) });
    res.writeHead(302, { location: `/admin/challenges/${id}` });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/dashboard') {
    return sendHtml(res, 200, renderLayout({
      title: 'ダッシュボード',
      activePath: '/dashboard',
      content: `<section class="card"><h1>ダッシュボード</h1><p class="muted">学習導線のハブです。次に解く問題や直近の提出結果を確認できます。</p><p><a class="cta" href="/">問題一覧へ</a></p></section>`
    }));
  }

  if (req.method === 'GET' && url.pathname === '/progress') {
    return sendHtml(res, 200, renderLayout({
      title: '進捗',
      activePath: '/progress',
      content: `<section class="card"><h1>進捗</h1><p class="muted">MVP段階のため、進捗は提出結果画面で確認してください。</p><p><a class="cta secondary" href="/">提出へ進む</a></p></section>`
    }));
  }

  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const response = await fetch(`${apiBaseUrl}/api/challenges`);
      if (!response.ok) {
        return sendHtml(res, 502, renderLayout({ title: '問題一覧', activePath: '/', content: renderStateCard('fail', '問題一覧の取得に失敗しました。時間をおいて再試行してください。') }));
      }
      const data = await response.json();
      const challenges = Array.isArray(data?.challenges) ? data.challenges : [];
      if (challenges.length === 0) {
        return sendHtml(res, 200, renderLayout({ title: '問題一覧', activePath: '/', content: renderStateCard('warn', '公開中の問題はまだありません。') }));
      }

      const filters = readChallengeCatalogFilters(url.searchParams);
      const filteredChallenges = filterChallenges(challenges, filters);
      const rows = filteredChallenges.map((challenge) => `<tr>
        <td><strong>${escapeHtml(challenge.title)}</strong><br /><span class="muted">${escapeHtml(challenge.slug)}</span></td>
        <td>${escapeHtml(challenge.difficulty)}</td>
        <td>${escapeHtml(challenge.category)}</td>
        <td>${escapeHtml((challenge.supportedLanguages ?? []).join(', '))}</td>
        <td><a class="cta" href="/challenges/${encodeURIComponent(challenge.slug)}">問題を開く</a></td>
      </tr>`).join('');
      const resultRows = rows || '<tr><td colspan="5" class="muted">条件に一致する問題がありません。条件を変更して再検索してください。</td></tr>';

      return sendHtml(res, 200, renderLayout({
        title: '問題一覧',
        activePath: '/',
        content: `<section class="card"><h1>問題一覧</h1><p class="muted">キーワード・難易度・カテゴリ・言語から、今取り組みたい問題を絞り込めます。</p>
        <form method="GET" action="/">
          <div class="filters">
            <label class="filter-field">キーワード<input type="text" name="q" maxlength="80" value="${escapeHtml(filters.keyword)}" placeholder="タイトル・slugを検索" /></label>
            <label class="filter-field">難易度<select name="difficulty">${renderFilterOptions(CHALLENGE_CATALOG_OPTIONS.difficulties, filters.difficulty)}</select></label>
            <label class="filter-field">カテゴリ<select name="category">${renderFilterOptions(CHALLENGE_CATALOG_OPTIONS.categories, filters.category)}</select></label>
            <label class="filter-field">言語<select name="language">${renderFilterOptions(CHALLENGE_CATALOG_OPTIONS.languages, filters.language)}</select></label>
          </div>
          <div class="filter-actions"><button class="cta" type="submit">絞り込む</button><a class="cta secondary" href="/">条件をクリア</a><span class="muted">${filteredChallenges.length}/${challenges.length}件を表示</span></div>
        </form>
        <div class="table-wrap"><table><tr><th>問題</th><th>難易度</th><th>カテゴリ</th><th>対応言語</th><th></th></tr>${resultRows}</table></div></section>`
      }));
    } catch {
      return sendHtml(res, 502, renderLayout({ title: '問題一覧', activePath: '/', content: renderStateCard('fail', 'API通信エラーが発生しました。') }));
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/challenges/')) {
    const slug = decodeURIComponent(url.pathname.replace('/challenges/', ''));
    try {
      const response = await fetch(`${apiBaseUrl}/api/challenges/${slug}`);
      if (response.status === 404) {
        return sendHtml(res, 404, renderLayout({ title: '問題詳細', activePath: '/', content: renderStateCard('warn', '問題が見つかりません。') }));
      }
      if (!response.ok) {
        return sendHtml(res, 502, renderLayout({ title: '問題詳細', activePath: '/', content: renderStateCard('fail', '問題詳細の取得に失敗しました。') }));
      }
      const { challenge } = await response.json();
      return sendHtml(res, 200, renderLayout({
        title: challenge.metadata.title,
        activePath: '/',
        content: `<section class="card"><h1>${escapeHtml(challenge.metadata.title)}</h1>
        <p><span class="badge ok">${escapeHtml(challenge.metadata.difficulty)}</span><span class="badge warn">${escapeHtml(challenge.metadata.category)}</span></p>
        <p><strong>編集対象:</strong> ${escapeHtml(challenge.starterCode.find((file) => !file.readonly)?.path ?? 'N/A')}</p>
        <p class="muted">${escapeHtml(challenge.statement.background)}</p>
        <p><strong>課題:</strong> ${escapeHtml(challenge.statement.issue)}</p>
        <h3>acceptance criteria</h3><ul>${challenge.statement.acceptanceCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <form method="POST" action="/submit">
          <input type="hidden" name="challengeSlug" value="${escapeHtml(challenge.metadata.slug)}" />
          <input type="hidden" name="language" value="${escapeHtml(challenge.metadata.supportedLanguages[0])}" />
          <textarea name="code">${escapeHtml(challenge.starterCodeContent)}</textarea>
          <p><button class="cta" type="submit">提出する</button> <a class="cta secondary" href="/">一覧へ戻る</a></p>
        </form></section>`
      }));
    } catch {
      return sendHtml(res, 502, renderLayout({ title: '問題詳細', activePath: '/', content: renderStateCard('fail', 'API通信エラーが発生しました。') }));
    }
  }

  if (req.method === 'POST' && url.pathname === '/submit') {
    const form = await parseFormBody(req);
    const payload = {
      challengeSlug: form.get('challengeSlug'),
      language: form.get('language'),
      code: form.get('code')
    };

    const response = await fetch(`${apiBaseUrl}/api/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const submission = await response.json();

    res.writeHead(302, { location: `/submissions/${submission.id}` });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname.startsWith('/submissions/')) {
    const id = url.pathname.replace('/submissions/', '');
    const response = await fetch(`${apiBaseUrl}/api/submissions/${id}`);
    if (response.status === 404) {
      return sendHtml(res, 404, renderLayout({ title: '提出結果', activePath: '/progress', content: renderStateCard('warn', '提出結果が見つかりません。') }));
    }
    const submission = await response.json();

    if (!submission.result) {
      return sendHtml(res, 200, renderLayout({ title: '提出結果', activePath: '/progress', content: `${renderStateCard('ok', '採点中です。1秒後に自動更新します。')}<meta http-equiv="refresh" content="1" />` }));
    }

    const visiblePass = submission.result.visibleTests.every((test) => test.passed);
    return sendHtml(
      res,
      200,
      renderLayout({
        title: '提出結果',
        activePath: '/progress',
        content: `<section class="card"><h1>提出結果</h1>
        <p><span class="badge ${visiblePass ? 'ok' : 'fail'}">${visiblePass ? 'success' : 'fail'}</span> visible tests ${submission.result.visibleTests.filter((test) => test.passed).length}/${submission.result.visibleTests.length}</p>
        <p><strong>実行時間:</strong> ${submission.result.durationMs}ms</p>
        <h3>visible tests</h3><ul>${submission.result.visibleTests.map((test) => `<li>${escapeHtml(test.testId)}: ${test.passed ? 'pass' : 'fail'} (${test.durationMs}ms)</li>`).join('')}</ul>
        <h3>hidden tests</h3><p>passed ${submission.result.hiddenTests.passedCount}/${submission.result.hiddenTests.total}</p>
        <h3>ログ</h3><pre>${escapeHtml(((submission.result.logs ?? ['(internal logsはadminのみ表示)']).join('\n\n')))}</pre>
        <p><a class="cta secondary" href="/progress">進捗へ</a></p></section>`
      })
    );
  }

  return sendHtml(res, 404, renderLayout({ title: 'Not Found', activePath: '/', content: '<section class="card"><h1>Not Found</h1></section>' }));
});

server.listen(port, () => {
  console.log(`web listening on http://localhost:${port}`);
});
