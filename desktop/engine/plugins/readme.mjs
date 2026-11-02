// Written into the plugins folder the first time KongGate starts.

export const PLUGINS_README = `KongGate plugins
================

Put your own plugins in this folder: one .mjs file each (JavaScript, as a
module). In the app, Settings > Plugins shows what was found here, and
"Reload" reads the folder again after you add or change a file. A work then
adds your plugin on its "Plugins" tab, like a built-in one.

Shu papkaga o'z plaginlaringizni qo'ying: har biri bitta .mjs fayl. Ilovada
Sozlamalar > Plaginlar bo'limi ularni ko'rsatadi; faylni o'zgartirgach
"Qayta yuklash"ni bosing.

Only put code here that you trust: a plugin runs inside KongGate, with all
the rights the app has on this computer.


AN EXAMPLE: hello.mjs
---------------------

export default {
  name: 'hello',                 // small letters, digits and "-"; unique
  title: 'Hello',                // what the app shows
  description: 'Greets the destination, and turns away clients without X-Team.',
  priority: 800,                 // where it goes in a work's list when added:
                                 // higher runs earlier (CORS 2000, JWT 1450,
                                 // rate limit 910, cache 100)

  // The settings, as the app's form shows them. Types: string, number,
  // boolean, select (with options: [...]), list (of strings), pairs (rows of
  // name and value). Each may have a label, help, default and required;
  // a string or list may be header: true (header names only); a number may
  // have min and max.
  fields: {
    greeting: { type: 'string', label: 'Greeting', default: 'salom', required: true },
    requireTeam: { type: 'boolean', label: 'Require X-Team', default: false },
  },

  // Before the request goes to the destination.
  access(ctx, config) {
    if (config.requireTeam && !ctx.request.header('X-Team')) {
      return ctx.respond(403, { message: 'say which team you are in (X-Team)' });
    }
    ctx.request.setHeader('X-Greeting', config.greeting);
  },

  // When the destination has answered, before the client gets the answer.
  response(ctx, config) {
    ctx.response.setHeader('X-Greeted', config.greeting);
  },
};


THE STEPS
---------

A plugin has one or more of these; each may be async (return a promise).

  rewrite(ctx, config)   First, for every plugin of the work, in their order.
  access(ctx, config)    Then, in order. A plugin that answers the client
                         itself (ctx.respond) ends it: the plugins after it
                         are not asked, and nothing goes to the destination.
  response(ctx, config)  When the destination answers, in order.

A browser's CORS preflight (OPTIONS) is not shown to plugins, unless the
plugin says onPreflight: true.


WHAT ctx HOLDS
--------------

ctx.work                      { id, name, path, methods, projectId }
ctx.client.ip                 the client's address
ctx.request.method            GET, POST, ...
ctx.request.path              the path asked for, without the query
ctx.request.query             URLSearchParams: change it to change what is sent
ctx.request.header(name)      a header as it will be sent (undefined if none)
ctx.request.incomingHeader(name)   a header as the client sent it
ctx.request.headers()         [[name, value], ...] as they will be sent
ctx.request.setHeader(name, value)
ctx.request.addHeader(name, value)
ctx.request.removeHeader(name)
ctx.response.setHeader(name, value)
                              in rewrite and access: put on whatever answer
                              the client gets; in response: on the answer
ctx.response.status           in response: the destination's answer code
ctx.response.header(name)     in response: a header of the answer
ctx.response.removeHeader(name)    in response
ctx.respond(status, body, headers)
                              answer the client now; body: an object (sent as
                              JSON), a string or a Buffer; headers:
                              [[name, value], ...]
ctx.consumer                  who a sign-in plugin before this one recognised
                              (JWT, API key, basic sign-in), or null
ctx.setConsumer(id)           for a sign-in plugin of your own
ctx.shared                    an object for plugins to leave things in for
                              later steps of the same request
ctx.log(message)              written to KongGate's error log (konggate.log)


WHEN SOMETHING GOES WRONG
-------------------------

A file that cannot be read, or does not describe a plugin, is listed with
the reason in Settings > Plugins. A plugin that throws, or takes longer than
10 seconds, makes the gateway answer 500 (reason "plugin"). A work that uses
a plugin this computer does not have answers 500 (reason "plugin_missing")
while that plugin is switched on in it: a sign-in plugin left out must not
let everyone in.
`;
