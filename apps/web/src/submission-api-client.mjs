const DEFAULT_SUBMISSION_ERROR = '提出を受け付けられませんでした。入力内容を確認して再試行してください。';
const API_UNAVAILABLE_ERROR = '提出APIに接続できませんでした。時間をおいて再試行してください。';

const readResponseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const readSafeErrorMessage = (data) => {
  if (typeof data?.error !== 'string') return DEFAULT_SUBMISSION_ERROR;
  const message = data.error.trim();
  if (message.length === 0) return DEFAULT_SUBMISSION_ERROR;
  return message.slice(0, 240);
};

export const submitChallengeToApi = async ({
  apiBaseUrl,
  payload,
  fetchImpl = fetch
}) => {
  try {
    const response = await fetchImpl(`${apiBaseUrl}/api/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await readResponseJson(response);

    if (!response.ok) {
      return Object.freeze({
        ok: false,
        statusCode: response.status,
        error: readSafeErrorMessage(data)
      });
    }

    if (typeof data?.id !== 'string' || data.id.length === 0) {
      return Object.freeze({
        ok: false,
        statusCode: 502,
        error: '提出APIの応答が不正です。時間をおいて再試行してください。'
      });
    }

    return Object.freeze({ ok: true, id: data.id });
  } catch {
    return Object.freeze({
      ok: false,
      statusCode: 502,
      error: API_UNAVAILABLE_ERROR
    });
  }
};
