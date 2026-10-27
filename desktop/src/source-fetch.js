'use strict';
// Fail fast while a source is down; honour Retry-After and do not penalize cancellation.
module.exports = function sourceFetch({ fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  const health = new Map();
  return async (url, options = {}) => {
    const host = new URL(url).origin, state = health.get(host) || { failures: 0, until: 0 };
    options.signal?.throwIfAborted();
    if (state.until > now()) throw new Error('Source cooling down');
    try {
      const response = await fetcher(url, options);
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        state.failures++;
        const retry = response.headers?.get('retry-after');
        const deadline = retry && /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry);
        state.until = Math.max(now() + Math.min(60000, 1000 * 2 ** Math.min(state.failures, 6)), Number.isFinite(deadline) ? deadline : 0);
        health.set(host, state);
      } else health.delete(host);
      return response;
    } catch (error) {
      if (!options.signal?.aborted) {
        state.failures++;
        state.until = now() + Math.min(60000, 1000 * 2 ** Math.min(state.failures, 6));
        health.set(host, state);
      }
      throw error;
    }
  };
};
