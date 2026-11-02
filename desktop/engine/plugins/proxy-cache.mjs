// Cache: answers to GET requests kept for some seconds, and given from here
// meanwhile, so the destination is asked less. Kept in memory: a restart
// starts it empty. Callers are told apart (by what a sign-in plugin before it
// recognised, and by the headers listed), so nobody is given someone else's
// answer.

import { refuse } from './fields.mjs';

const MAX_ENTRIES = 1000;

export default {
  name: 'proxy-cache',
  title: 'Cache',
  description: 'Keeps answers to GET requests for some seconds and gives them from memory meanwhile.',
  priority: 100,
  fields: {
    ttlSeconds: { type: 'number', label: 'Kept for, seconds', default: 60, min: 1, max: 86400 },
    statuses: { type: 'list', label: 'Answer codes kept', default: ['200'] },
    varyHeaders: {
      type: 'list',
      label: 'Kept apart by headers',
      header: true,
      default: ['Authorization', 'Cookie', 'X-API-Key', 'Accept', 'Accept-Encoding', 'Accept-Language'],
      help: 'Requests that differ in one of these get answers of their own.',
    },
    maxEntryKilobytes: { type: 'number', label: 'Largest answer kept, KB', default: 1024, min: 1, max: 102400 },
  },

  check(config) {
    config.ttlSeconds = Math.round(config.ttlSeconds);
    config.maxEntryKilobytes = Math.round(config.maxEntryKilobytes);
    for (const status of config.statuses) {
      if (!/^[1-5]\d\d$/.test(status)) refuse(`Cache: "${status}" is not an answer code`);
    }
  },

  prepare() {
    const entries = new Map();
    return {
      entries,
      sweep() {
        const now = Date.now();
        for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key);
      },
    };
  },

  access(ctx, config, state) {
    const { method } = ctx.request;
    if (method !== 'GET' && method !== 'HEAD') {
      ctx.response.setHeader('X-Cache-Status', 'Bypass');
      return;
    }

    // HEAD is answered from what GET kept.
    const key = JSON.stringify([
      ctx.request.path,
      ctx.request.query.toString(),
      ctx.consumer,
      ...config.varyHeaders.map((name) => ctx.request.incomingHeader(name) ?? null),
    ]);

    const entry = state.entries.get(key);
    if (entry && entry.expires > Date.now()) {
      const age = String(Math.floor((Date.now() - entry.storedAt) / 1000));
      ctx.respond(entry.status, entry.body, [...entry.headers, ['Age', age], ['X-Cache-Status', 'Hit']]);
      return;
    }

    if (method === 'GET') ctx.shared.cacheKey = key;
    ctx.response.setHeader('X-Cache-Status', 'Miss');
  },

  response(ctx, config, state) {
    const key = ctx.shared.cacheKey;
    if (!key || !config.statuses.includes(String(ctx.response.status))) return;

    // What is meant for one caller only is not kept.
    const cacheControl = (ctx.response.header('cache-control') ?? '').toLowerCase();
    if (ctx.response.header('set-cookie') !== undefined || /no-store|private/.test(cacheControl)) return;
    if ((ctx.response.header('vary') ?? '').includes('*')) return;

    const status = ctx.response.status;
    const headers = ctx.response.destinationHeaders();
    ctx.response.onBody((body) => {
      if (!body) return;
      if (state.entries.size >= MAX_ENTRIES) state.entries.delete(state.entries.keys().next().value);
      const now = Date.now();
      state.entries.set(key, { status, headers, body, storedAt: now, expires: now + config.ttlSeconds * 1000 });
    }, { maxBytes: config.maxEntryKilobytes * 1024 });
  },
};
