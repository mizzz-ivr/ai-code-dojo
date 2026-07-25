import { setTimeout as sleepWithTimer } from 'node:timers/promises';

const validateNextAttempt = (nextAttempt) => {
  if (!Number.isInteger(nextAttempt) || nextAttempt < 2) {
    throw new TypeError('application retry nextAttempt must be an integer greater than or equal to 2');
  }
};

const validateRandomValue = (value) => {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new TypeError('application retry random must return a value greater than or equal to 0 and less than 1');
  }
};

export const createApplicationRetryBackoff = ({
  config,
  random = Math.random,
  sleep = sleepWithTimer
}) => {
  if (!config || typeof config !== 'object') {
    throw new TypeError('application retry backoff config is required');
  }
  if (typeof random !== 'function') {
    throw new TypeError('application retry backoff random is required');
  }
  if (typeof sleep !== 'function') {
    throw new TypeError('application retry backoff sleep is required');
  }

  const calculate = ({ nextAttempt }) => {
    validateNextAttempt(nextAttempt);

    const retryOrdinal = nextAttempt - 2;
    if (!config.enabled) {
      return {
        backoffEnabled: false,
        retryOrdinal,
        delayMs: 0,
        capDelayMs: 0
      };
    }

    const exponentialCap = config.baseDelayMs * (2 ** retryOrdinal);
    const capDelayMs = Math.min(config.maxDelayMs, exponentialCap);
    const randomValue = random();
    validateRandomValue(randomValue);

    return {
      backoffEnabled: true,
      retryOrdinal,
      delayMs: Math.floor(capDelayMs * randomValue),
      capDelayMs
    };
  };

  const wait = async (delayMs) => {
    if (!Number.isInteger(delayMs) || delayMs < 0) {
      throw new TypeError('application retry delayMs must be a non-negative integer');
    }
    if (delayMs === 0) return;
    await sleep(delayMs);
  };

  return { calculate, wait };
};
