// Rate limit: so many requests a minute, per client address, per value of a
// header, or per caller that a sign-in plugin before it recognised.

import { refuse } from './fields.mjs';

export default {
  name: 'rate-limit',
  title: 'Rate limit',
  description: 'Answers 429 to a client that sends more requests a minute than allowed.',
  priority: 910,
  fields: {
    perMinute: { type: 'number', label: 'Requests a minute', default: 60, min: 1, max: 1_000_000 },
    by: {
      type: 'select',
      label: 'Counted per',
      options: ['ip', 'header', 'consumer'],
      default: 'ip',
      help: 'ip: client address; header: value of a request header; consumer: who a sign-in plugin before this one recognised.',
    },
    header: { type: 'string', label: 'Header counted by', default: '', header: true, when: { by: 'header' } },
  },

  check(config, { enabled }) {
    config.perMinute = Math.round(config.perMinute);
    if (enabled && config.by === 'header' && !config.header) refuse('name the header requests are counted by');
  },

  // Requests counted per client, within the current minute.
  prepare() {
    const counters = new Map();
    return {
      counters,
      sweep() {
        const minute = Math.floor(Date.now() / 60000);
        for (const [key, counter] of counters) {
          if (counter.minute !== minute) counters.delete(key);
        }
      },
    };
  },

  access(ctx, config, state) {
    // Counted after the plugins before it, so that a header filled from the
    // token counts per token user. A request without one is counted by address.
    const identity =
      (config.by === 'header' && ctx.request.header(config.header)) ||
      (config.by === 'consumer' && ctx.consumer) ||
      ctx.client.ip;

    const now = Date.now();
    const minute = Math.floor(now / 60000);
    let counter = state.counters.get(identity);
    if (!counter || counter.minute !== minute) {
      counter = { minute, count: 0 };
      state.counters.set(identity, counter);
    }
    counter.count += 1;

    const limit = config.perMinute;
    const reset = String(Math.ceil(((minute + 1) * 60000 - now) / 1000));
    ctx.response.setHeader('RateLimit-Limit', String(limit));
    ctx.response.setHeader('RateLimit-Remaining', String(Math.max(0, limit - counter.count)));
    ctx.response.setHeader('RateLimit-Reset', reset);
    if (counter.count > limit) {
      ctx.respond(429, { message: 'request limit exceeded', reason: 'rate_limit' }, [['Retry-After', reset]]);
    }
  },
};
