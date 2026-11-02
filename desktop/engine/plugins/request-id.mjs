// Request id: gives every request an id the destination receives (and the
// client too, if asked), for telling one request from another in logs.

import { randomUUID } from 'node:crypto';

export default {
  name: 'request-id',
  title: 'Request id',
  description: 'Gives every request an id in a header. An id the client already sent is kept.',
  priority: 750,
  onPreflight: true,
  fields: {
    header: { type: 'string', label: 'Header', default: 'X-Request-Id', header: true, required: true },
    echo: { type: 'boolean', label: 'Also send it back to the client', default: true },
  },

  access(ctx, config) {
    let id = ctx.request.header(config.header);
    if (!id) {
      id = randomUUID();
      ctx.request.setHeader(config.header, id);
    }
    if (config.echo) ctx.response.setHeader(config.header, id);
  },
};
