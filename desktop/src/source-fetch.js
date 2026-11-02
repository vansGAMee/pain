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
      if ([403,408,429,451].includes(response.status) || response.status >= 500) {
        state.failures++;
        const retry = response.headers?.get('retry-after');
        const deadline = retry && /^\d+(?:\.\d+)?$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry);
        state.until = Number.isFinite(deadline) && deadline > now() ? deadline
          : now() + Math.min(60000, 1000 * 2 ** Math.min(state.failures, 6));
        health.set(host, state);
      } else health.delete(host);
      return response;
    } catch (error) {
      if (!options.signal?.aborted || options.signal.reason?.name === 'TimeoutError') {
        state.failures++;
        state.until = now() + Math.min(60000, 1000 * 2 ** Math.min(state.failures, 6));
        health.set(host, state);
      }
      throw error;
    }
  };
};
