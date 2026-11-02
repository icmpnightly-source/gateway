// Size limit: a request body larger than allowed is refused (413) before it
// reaches the destination, whether it says its size or not.

export default {
  name: 'request-size-limit',
  title: 'Size limit',
  description: 'Refuses request bodies larger than allowed (413).',
  priority: 1500,
  fields: {
    maxKilobytes: { type: 'number', label: 'Largest body, KB', default: 1024, min: 1, max: 10_485_760 },
  },

  check(config) {
    config.maxKilobytes = Math.round(config.maxKilobytes);
  },

  access(ctx, config) {
    const max = config.maxKilobytes * 1024;
    const message = `the request body is larger than ${config.maxKilobytes} KB`;

    const length = Number(ctx.request.incomingHeader('content-length'));
    if (Number.isFinite(length) && length > max) return ctx.respond(413, { message, reason: 'too_large' });
    // A body that does not say its size is counted on its way through.
    ctx.request.limitBody(max, message);
    return undefined;
  },
};
