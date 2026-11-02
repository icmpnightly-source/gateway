// Answer changes: headers of the destination's answer removed, set or added
// before it goes back to the client.

export default {
  name: 'response-transformer',
  title: 'Answer changes',
  description: "Removes, sets or adds headers on the destination's answer before it goes back to the client.",
  priority: 800,
  fields: {
    removeHeaders: { type: 'list', label: 'Remove headers', header: true },
    setHeaders: { type: 'pairs', label: 'Set headers', header: true, help: 'Always sent with this value.' },
    addHeaders: { type: 'pairs', label: 'Add headers', header: true, help: 'Sent only when the destination did not send the header.' },
  },

  response(ctx, config) {
    const { response } = ctx;
    for (const name of config.removeHeaders) response.removeHeader(name);
    for (const { name, value } of config.setHeaders) response.setHeader(name, value);
    for (const { name, value } of config.addHeaders) {
      if (response.header(name) === undefined) response.setHeader(name, value);
    }
  },
};
