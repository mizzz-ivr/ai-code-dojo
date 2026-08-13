const readTimeout = (value) => {
  const parsed = value == null || value === '' ? 15000 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120000) {
    throw new Error('PYTHON_REMOTE_RUNNER_TIMEOUT_MS is invalid');
  }
  return parsed;
};

const isLocalHostname = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

export const loadPythonRemoteRunnerConfig = (env = process.env) => {
  const rawUrl = env.PYTHON_REMOTE_RUNNER_URL ?? '';
  if (!rawUrl) return Object.freeze({ enabled: false });

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('PYTHON_REMOTE_RUNNER_URL is invalid');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('PYTHON_REMOTE_RUNNER_URL must not include credentials, query, or fragment');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname) && env.NODE_ENV !== 'production')) {
    throw new Error('PYTHON_REMOTE_RUNNER_URL must use HTTPS outside local non-production environments');
  }

  const sharedSecret = env.PYTHON_REMOTE_RUNNER_SHARED_SECRET ?? '';
  if (sharedSecret.length < 32) {
    throw new Error('PYTHON_REMOTE_RUNNER_SHARED_SECRET must be at least 32 characters');
  }

  const normalizedBaseUrl = `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
  return Object.freeze({
    enabled: true,
    baseUrl: normalizedBaseUrl,
    sharedSecret,
    timeoutMs: readTimeout(env.PYTHON_REMOTE_RUNNER_TIMEOUT_MS)
  });
};
