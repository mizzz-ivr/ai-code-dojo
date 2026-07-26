import http from 'node:http';
import { listChallenges, getChallengeBySlug } from './repositories/challenge-repository.mjs';
import { createSubmissionAndEnqueue, getSubmissionResult } from './services/submission-service.mjs';
import { listAdminChallenges, getAdminChallengeById, createAdminChallenge, createAdminChallengeVersion, setChallengePublishStatus, findPublishedChallengeBySlug } from './repositories/admin-challenge-repository.mjs';
import { login, setSessionCookie, clearSessionCookie, getUserFromRequest } from './auth.mjs';
import { loadQueueOutboxConfig } from './config/queue-outbox-config.mjs';
import { startQueueOutboxDispatcher } from './services/queue-outbox-dispatcher.mjs';

const port = Number(process.env.API_PORT ?? 8080);
const queueOutboxConfig = loadQueueOutboxConfig();
const queueOutboxDispatcher = startQueueOutboxDispatcher({ config: queueOutboxConfig });

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const validateAdminPayload = (body) => {
  if (!body?.slug || !body?.versionData?.metadata?.title) return 'slug と versionData.metadata.title は必須です。';
  if (!Array.isArray(body.versionData.visibleTests) || !Array.isArray(body.versionData.hiddenTests)) return 'visibleTests/hiddenTests は配列で指定してください。';
  if (!body.versionData.runnerConfig || !body.versionData.reviewConfig) return 'runnerConfig/reviewConfig は必須です。';
  return null;
};

const buildReviewPreview = (slug, reviewConfig) => ({
  prTitle: (reviewConfig.prTitleTemplate ?? `【${slug}】課題の改善`)
    .replaceAll('{{slug}}', slug),
  prBody: (reviewConfig.prBodyTemplate ?? '## 概要\n- 課題の要件を満たす修正を行いました。')
    .replaceAll('{{slug}}', slug),
  reviewerComments: reviewConfig.reviewerCommentTemplates ?? ['要件の網羅性とテスト観点を確認しました。'],
  summary: (reviewConfig.focusPoints ?? []).join(' / ') || '要件を満たすための最小修正'
});

const forbidden = (res) => sendJson(res, 403, { error: 'forbidden' });
const unauthorized = (res) => sendJson(res, 401, { error: 'unauthorized' });

const requireRole = (req, res, role) => {
  const user = getUserFromRequest(req);
  if (!user) { unauthorized(res); return null; }
  if (user.role !== role) { forbidden(res); return null; }
  return user;
};

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'api' });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const auth = login(body?.username, body?.password);
      if (!auth) return unauthorized(res);
      setSessionCookie(res, auth.token);
      return sendJson(res, 200, { user: auth.user });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const user = getUserFromRequest(req);
      if (!user) return unauthorized(res);
      return sendJson(res, 200, { user });
    }

    if (req.method === 'GET' && url.pathname === '/api/challenges') {
      const items = await listChallenges();
      return sendJson(res, 200, { challenges: items });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/challenges/')) {
      const slug = url.pathname.replace('/api/challenges/', '');
      try {
        const challenge = await getChallengeBySlug(slug);
        return sendJson(res, 200, { challenge });
      } catch (error) {
        if (error.code === 'ENOENT') {
          return sendJson(res, 404, { error: 'challengeが見つかりません。' });
        }
        throw error;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/challenges') {
      if (!requireRole(req, res, 'admin')) return;
      const challenges = await listAdminChallenges();
      return sendJson(res, 200, { challenges });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/admin/challenges/')) {
      if (!requireRole(req, res, 'admin')) return;
      const id = url.pathname.replace('/api/admin/challenges/', '');
      const challenge = await getAdminChallengeById(id);
      if (!challenge) return sendJson(res, 404, { error: 'challengeが見つかりません。' });
      return sendJson(res, 200, { challenge });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/challenges') {
      if (!requireRole(req, res, 'admin')) return;
      const body = await parseBody(req);
      const err = validateAdminPayload(body);
      if (err) return sendJson(res, 400, { error: err });
      try {
        const created = await createAdminChallenge(body);
        return sendJson(res, 201, created);
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname.endsWith('/versions') && url.pathname.startsWith('/api/admin/challenges/')) {
      if (!requireRole(req, res, 'admin')) return;
      const id = url.pathname.replace('/api/admin/challenges/', '').replace('/versions', '');
      const body = await parseBody(req);
      const err = validateAdminPayload({ slug: 'dummy', versionData: body?.versionData ?? body });
      if (err) return sendJson(res, 400, { error: err });
      const versionId = await createAdminChallengeVersion(id, body.versionData ?? body);
      if (!versionId) return sendJson(res, 404, { error: 'challengeが見つかりません。' });
      return sendJson(res, 201, { versionId });
    }

    if (req.method === 'PATCH' && url.pathname.endsWith('/publish') && url.pathname.startsWith('/api/admin/challenges/')) {
      if (!requireRole(req, res, 'admin')) return;
      const id = url.pathname.replace('/api/admin/challenges/', '').replace('/publish', '');
      const body = await parseBody(req);
      const status = body?.status;
      if (!['published', 'draft'].includes(status)) return sendJson(res, 400, { error: 'statusはpublishedまたはdraftです。' });
      const challenge = await setChallengePublishStatus(id, status);
      if (!challenge) return sendJson(res, 404, { error: 'challengeが見つかりません。' });
      return sendJson(res, 200, { challenge });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/challenges/') && url.pathname.endsWith('/review-preview')) {
      const slug = url.pathname.replace('/api/challenges/', '').replace('/review-preview', '');
      const found = await findPublishedChallengeBySlug(slug);
      if (!found) return sendJson(res, 404, { error: 'review preview対象が見つかりません。' });
      return sendJson(res, 200, { reviewPreview: buildReviewPreview(slug, found.version.reviewConfig) });
    }

    if (req.method === 'POST' && url.pathname === '/api/submissions') {
      const body = await parseBody(req);
      const result = await createSubmissionAndEnqueue(body, {
        outboxConfig: queueOutboxConfig,
        dispatchOutbox: ({ trigger }) => queueOutboxDispatcher.trigger(trigger)
      });
      if (result.error) return sendJson(res, result.statusCode, { error: result.error });
      return sendJson(res, result.statusCode, result.data);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/submissions/')) {
      const id = url.pathname.replace('/api/submissions/', '');
      const user = getUserFromRequest(req);
      const result = await getSubmissionResult(id, { role: user?.role ?? 'guest' });
      if (result.error) return sendJson(res, result.statusCode, { error: result.error });
      return sendJson(res, result.statusCode, result.data);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    return sendJson(res, 500, { error: `internal error: ${error.message}` });
  }
});

server.on('close', () => queueOutboxDispatcher.stop());

server.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
