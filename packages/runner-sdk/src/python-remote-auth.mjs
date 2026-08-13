import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

export const createPythonRunnerSignature = ({ secret, timestamp, idempotencyKey, body }) => {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('python runner shared secret must be at least 32 characters');
  }
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${idempotencyKey}\n${body}`, 'utf8')
    .digest('hex');
};

export const verifyPythonRunnerSignature = ({ secret, timestamp, idempotencyKey, body, signature }) => {
  if (typeof signature !== 'string' || !SIGNATURE_PATTERN.test(signature)) return false;
  let expected;
  try {
    expected = createPythonRunnerSignature({ secret, timestamp, idempotencyKey, body });
  } catch {
    return false;
  }
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(signature, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};
