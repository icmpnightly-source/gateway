// API keys: a client is let in with one of the keys given out for the work,
// sent in a header or a query parameter. Keys are kept as hashes: the app
// shows a key once, when it is made, and never again.

import { keyHash, refuse } from './fields.mjs';

export default {
  name: 'key-auth',
  title: 'API key',
  description: 'Lets in only clients that send one of the API keys given out for this work.',
  priority: 1250,
  fields: {
    keys: { type: 'keys', label: 'Keys' },
    header: { type: 'string', label: 'Header the key is sent in', default: 'X-API-Key', header: true },
    queryParam: { type: 'string', label: 'Or query parameter', default: '', help: 'Such as apikey: /path?apikey=… Empty: header only.' },
    hideCredentials: { type: 'boolean', label: "Don't pass the key on to the destination", default: true },
    consumerHeader: { type: 'string', label: "Header with the key's name, for the destination", default: 'X-Consumer', header: true },
  },

  check(config) {
    if (!config.header && !config.queryParam) refuse('API key: name the header or the query parameter the key is sent in');
  },

  secretHeaders: (config) => (config.header ? [config.header] : []),
  secretQuery: (config) => (config.queryParam ? [config.queryParam] : []),

  prepare(config) {
    return { names: new Map(config.keys.map((key) => [key.hash, key.name])) };
  },

  access(ctx, config, state) {
    const given = (config.header && ctx.request.incomingHeader(config.header)?.trim()) || (config.queryParam && ctx.request.query.get(config.queryParam)) || '';
    if (!given) return ctx.respond(401, { message: 'Unauthorized: no API key', reason: 'key' });

    const name = state.names.get(keyHash(given));
    if (name === undefined) return ctx.respond(401, { message: 'Unauthorized: the API key is not valid', reason: 'key' });

    ctx.setConsumer(`key:${name}`);
    if (config.hideCredentials) {
      if (config.header) ctx.request.removeHeader(config.header);
      if (config.queryParam) ctx.request.query.delete(config.queryParam);
    }
    if (config.consumerHeader) ctx.request.setHeader(config.consumerHeader, name);
    return undefined;
  },
};
