// Request changes: headers and query parameters removed, renamed, set or
// added before the request goes to the destination. "Set" is what the
// destination always receives, whatever the client sent.

import { HEADER, refuse } from './fields.mjs';

export default {
  name: 'request-transformer',
  title: 'Request changes',
  description: 'Removes, renames, sets or adds request headers and query parameters before the request goes on.',
  priority: 801,
  onPreflight: true,
  fields: {
    removeHeaders: { type: 'list', label: 'Remove headers', header: true },
    renameHeaders: { type: 'pairs', label: 'Rename headers', header: true, help: 'Name: the header as sent; value: its new name.' },
    setHeaders: { type: 'pairs', label: 'Set headers', header: true, help: 'Always sent with this value, whatever the client sent.' },
    addHeaders: { type: 'pairs', label: 'Add headers', header: true, help: 'Sent only when the client did not send the header.' },
    removeQuery: { type: 'list', label: 'Remove query parameters' },
    setQuery: { type: 'pairs', label: 'Set query parameters' },
  },

  check(config) {
    for (const { value } of config.renameHeaders) {
      if (!HEADER.test(value)) refuse(`Request changes: "${value}" is not a header name`);
    }
  },

  access(ctx, config) {
    const { request } = ctx;
    for (const name of config.removeHeaders) request.removeHeader(name);
    for (const { name, value: renamed } of config.renameHeaders) {
      const value = request.header(name);
      if (value === undefined) continue;
      request.removeHeader(name);
      request.setHeader(renamed, value);
    }
    for (const { name, value } of config.setHeaders) request.setHeader(name, value);
    for (const { name, value } of config.addHeaders) {
      if (request.header(name) === undefined) request.setHeader(name, value);
    }
    for (const name of config.removeQuery) request.query.delete(name);
    for (const { name, value } of config.setQuery) request.query.set(name, value);
  },
};
