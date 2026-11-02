// What the app's own window talks to: the API behind every screen, the built
// UI's files, a door to the gateway for the "try it" dialog, and an echo
// service to point a first work at. Served to this computer only.

import { createPublicKey, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { ALGORITHMS, decodeBase64Url, isHmac } from './jwt.mjs';
import { pathMatches, upstreamPathOf } from './gateway.mjs';
import { describePlugin, jwtOf, withPlugins } from './plugins/index.mjs';
import { describeConnectionError } from './secrets-db.mjs';
import { sendRequest } from './sender.mjs';
import { Refusal } from './store.mjs';
import { workFrom } from './works.mjs';

const MAX_BODY = 1024 * 1024;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'null'];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

// --- what a project file may hold -------------------------------------------------

const refuse = (message) => {
  throw new Refusal(400, message);
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);

const tokenFieldsFrom = (input) =>
  list(input)
    .filter((field) => text(field?.path) && TOKEN_FIELD_TYPES.includes(field?.type))
    .map((field) => ({ path: text(field.path), type: field.type }));

// Two works on one path only coexist when their methods never overlap.
const clash = (a, b) =>
  a.path === b.path &&
  (a.methods.length === 0 || b.methods.length === 0 || a.methods.some((method) => b.methods.includes(method)));

/**
 * A project file, as export writes it, checked and turned into what the store
 * adds. A secret is named in the file, never carried in it: the name is
 * matched with a secret that is known here (`secretIds`, by name), or becomes
 * one whose value is yet to be entered. Format 1 files, from before plugins,
 * have their works turned into plugins.
 */
function projectFromFile(file, secretIds, registry) {
  if (![1, 2].includes(file?.konggate) || typeof file.project !== 'object' || file.project === null) {
    refuse('this is not a KongGate project file');
  }

  const name = text(file.project.name);
  if (!name || name.length > 100) refuse('the project in the file has no name');

  const algorithms = new Map(list(file.secrets).map((secret) => [text(secret?.name), secret?.algorithm]));
  const placeholders = new Map();
  const secretIdFor = (secretName) => {
    const existing = secretIds.get(secretName);
    if (existing) return existing;

    if (!placeholders.has(secretName)) {
      const algorithm = algorithms.get(secretName);
      if (!ALGORITHMS.includes(algorithm)) refuse(`the file does not say what kind of secret "${secretName}" is`);
      placeholders.set(secretName, { id: randomUUID(), name: secretName, algorithm });
    }
    return placeholders.get(secretName).id;
  };

  const missingPlugins = new Set();
  const works = list(file.works).map((given) => {
    const work = withPlugins(given);
    const plugins = list(work.plugins).map((plugin) => {
      if (typeof plugin?.name === 'string' && !registry.get(plugin.name)) missingPlugins.add(plugin.name);
      if (plugin?.name !== 'jwt') return plugin;

      const verify = plugin.config?.verify ?? {};
      const secretName = text(verify.secret);
      // A work that verified against a secret nobody can name any more still
      // verifies: against nothing, so it lets no token through until one is chosen.
      const secretId = secretName ? secretIdFor(secretName) : verify.enabled ? randomUUID() : '';
      const { secret: _secret, ...rest } = verify;
      return { ...plugin, config: { ...plugin.config, verify: { ...rest, secretId } } };
    });
    return workFrom({ ...work, plugins }, registry);
  });
  if (new Set(works.map((work) => work.name)).size !== works.length) refuse('two works in the file share a name');

  return {
    name,
    tokenFields: tokenFieldsFrom(file.project.tokenFields),
    works,
    placeholders: [...placeholders.values()],
    missingPlugins: [...missingPlugins],
  };
}

function secretFrom(input, { partial }) {
  const secret = {};

  if (input?.name !== undefined || !partial) {
    secret.name = text(input?.name);
    if (!secret.name || secret.name.length > 100) refuse('the secret needs a name');
  }
  if (input?.algorithm !== undefined || !partial) {
    secret.algorithm = input?.algorithm;
    if (!ALGORITHMS.includes(secret.algorithm)) refuse('unknown algorithm');
  }
  if ((input?.value !== undefined && input.value !== '') || !partial) {
    secret.value = typeof input?.value === 'string' ? input.value : '';
    secret.valueIsBase64 = Boolean(input?.valueIsBase64);
    if (secret.value.trim() === '') refuse('the secret needs a value');
  }

  return secret;
}

// A value that could never verify a token is better turned down when it is
// entered than found out one failed request at a time.
function checkSecretValue(algorithm, value, valueIsBase64) {
  if (isHmac(algorithm)) {
    if (valueIsBase64 && !decodeBase64Url(value.trim())?.length) refuse('the value is not base64');
    return;
  }
  try {
    createPublicKey(value);
  } catch {
    refuse('the value is not a public key in PEM form (-----BEGIN PUBLIC KEY-----)');
  }
}

// --- plumbing -------------------------------------------------------------------

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Refusal(413, 'too much data'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.once('error', reject);
    req.once('end', () => {
      if (size === 0) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(typeof body === 'object' && body !== null ? body : {});
      } catch {
        reject(new Refusal(400, 'the request is not JSON'));
      }
    });
  });
}

function echo(req, res, pathname) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    if (size < MAX_BODY) chunks.push(chunk);
    size += chunk.length;
  });
  req.once('end', () => {
    send(res, 200, {
      method: req.method,
      path: pathname.slice('/echo'.length) || '/',
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
  });
}

function serveFile(res, file, { cached }) {
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    // The build names its files after their contents, so those never change;
    // the page that names them is fetched anew each time.
    'Cache-Control': cached ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function serveUi(res, uiDir, pathname) {
  const index = uiDir && path.join(uiDir, 'index.html');
  if (!index || !existsSync(index)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('The app\'s screens are not built yet (frontend: npm run build).');
    return;
  }

  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    relative = '/';
  }
  const file = path.join(uiDir, relative);
  const inside = file.startsWith(uiDir + path.sep);

  if (inside && existsSync(file) && statSync(file).isFile()) {
    serveFile(res, file, { cached: relative.startsWith('/assets/') });
  } else {
    // One page handles every address, so anything that isn't a file is the app.
    serveFile(res, index, { cached: false });
  }
}

/**
 * `engine` is what index.mjs builds: the settings, the data file, the sessions
 * and the gateway, behind the handful of calls used below.
 */
export function createApi(engine) {
  // --- who may call -----------------------------------------------------------

  // A page of some other site, open in a browser on this computer, could try
  // to call this API behind the user's back. Browsers say where a call comes
  // from; anything that is not the app's own window is turned away.
  function comesFromTheApp(req) {
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;

    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;

    const { origin } = req.headers;
    if (origin && origin !== `http://${host}` && !engine.devOrigins.includes(origin)) return false;

    return true;
  }

  const sessionOf = (req) => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];

  function adminOnly(req) {
    if (!engine.sessions.isValid(sessionOf(req))) throw new Refusal(401, 'administrator sign-in required');
  }

  // --- trying a work out -------------------------------------------------------

  // Sends what the "try it" page asked for, to the gateway as a client would,
  // or past it to where the work forwards. Where to is worked out here, from
  // the work: the page names a path of the work, never an address.
  async function sendFor(work, input) {
    const method = text(input.method).toUpperCase();
    if (!METHODS.includes(method)) refuse('unknown method');

    const asked = text(input.path);
    if (!asked.startsWith('/') || /[\s#]/.test(asked)) refuse('the path has to start with "/" and hold no spaces or "#"');
    const at = new URL(asked, 'http://gateway');
    if (!pathMatches(work.path, at.pathname)) refuse("the path is not one of this work's");

    const headers = list(input.headers).map((header) => ({
      name: text(header?.name),
      value: typeof header?.value === 'string' ? header.value : '',
    }));
    const body = typeof input.body === 'string' && input.body !== '' ? input.body : undefined;
    const agentName = `KongGate/${engine.status().version}`;

    if (input.via === 'direct') {
      let base = null;
      try {
        base = new URL(work.destination);
      } catch {
        // Told below, as the gateway itself would tell it.
      }
      if (!base || !['http:', 'https:'].includes(base.protocol)) {
        return { url: work.destination, ms: 0, failed: { reason: 'bad_destination', message: "the work's destination is not a usable address" } };
      }
      const url = `${base.protocol}//${base.host}${upstreamPathOf(work, base, at.pathname, at.search)}`;
      return sendRequest({ url, method, headers, body, timeoutSeconds: work.timeoutSeconds, agentName });
    }

    const { gateway } = engine.status();
    const url = `http://127.0.0.1:${gateway.port}${at.pathname}${at.search}`;
    if (!gateway.running) return { url, ms: 0, failed: { reason: 'gateway_down', message: 'the gateway is not running' } };
    // Longer than the work waits for its destination, so that when that one
    // is late it is the gateway's own answer that comes back.
    return sendRequest({ url, method, headers, body, timeoutSeconds: work.timeoutSeconds + 10, agentName });
  }

  // --- the calls ---------------------------------------------------------------

  async function route(req, res, pathname, query) {
    const { method } = req;
    const [, , resource, id, action] = pathname.split('/');
    const is = (wantedMethod, wantedResource, { withId = false, wantedAction } = {}) =>
      method === wantedMethod &&
      resource === wantedResource &&
      Boolean(id) === (withId || Boolean(wantedAction)) &&
      action === wantedAction;

    // --- this computer ---

    if (is('GET', 'status')) return send(res, 200, engine.status());
    if (is('GET', 'settings')) return send(res, 200, engine.shownSettings());
    if (method === 'POST' && resource === 'settings' && id === 'test' && !action) {
      const body = await readJson(req);
      return send(res, 200, await engine.testDatabase(body.database ?? {}));
    }
    if (is('PUT', 'settings')) {
      await engine.applySettings(await readJson(req));
      return send(res, 200, engine.status());
    }

    // "konggate stop": answered first, then acted on, or there would be nobody left to answer.
    if (is('POST', 'quit')) {
      if (!engine.quit) throw new Refusal(501, 'this KongGate cannot be stopped from here');
      send(res, 204);
      setTimeout(engine.quit, 100);
      return undefined;
    }

    if (is('GET', 'requests')) {
      return send(res, 200, engine.log.list({
        workId: query.get('workId') || undefined,
        projectId: query.get('projectId') || undefined,
        limit: Math.min(1000, Number(query.get('limit')) || 200),
      }));
    }
    if (is('GET', 'requests', { withId: true })) {
      const entry = engine.log.find(id);
      if (!entry) throw new Refusal(404, 'this request is no longer in the log');
      return send(res, 200, entry);
    }
    if (is('DELETE', 'requests')) {
      engine.log.clear();
      return send(res, 204);
    }

    // --- what the data file holds ---

    const db = engine.store;

    if (is('GET', 'projects')) return send(res, 200, await db.projects());
    if (is('GET', 'projects', { wantedAction: 'export' })) {
      // The works' secrets are written by name, which takes the list of them.
      return send(res, 200, db.exportProject(id, await engine.secretsStore().secrets()));
    }
    if (method === 'POST' && resource === 'projects' && id === 'import' && !action) {
      const file = await readJson(req);
      const secretsStore = engine.secretsStore();
      const secretIds = new Map((await secretsStore.secrets()).map((secret) => [secret.name, secret.id]));
      const incoming = projectFromFile(file, secretIds, engine.plugins.registry);

      // The secrets first: if they cannot be added, nothing of the project is.
      if (incoming.placeholders.length > 0) {
        const taken = await secretsStore.addPlaceholders(incoming.placeholders);
        // Somebody may have added one of the names in the meantime, under an id of their own.
        for (const placeholder of incoming.placeholders) {
          const actual = taken.get(placeholder.name);
          for (const { config } of incoming.works) {
            const plugin = jwtOf(config);
            if (plugin?.config.verify.secretId === placeholder.id) plugin.config.verify.secretId = actual;
          }
        }
      }

      const existing = db.works();
      const project = db.importProject({
        name: incoming.name,
        tokenFields: incoming.tokenFields,
        works: incoming.works.map(({ name: workName, config }) => ({ name: workName, config })),
      });
      await engine.reload();

      const projectNames = new Map(db.projects().map((candidate) => [candidate.id, candidate.name]));
      return send(res, 201, {
        project,
        works: incoming.works.length,
        // Secrets the works name that were not here: an administrator has to enter their values.
        missingSecrets: incoming.placeholders.map((secret) => ({ name: secret.name, algorithm: secret.algorithm })),
        // Plugins the works use that this computer does not have: those works answer nothing until they are added.
        missingPlugins: incoming.missingPlugins,
        // Works that answer a path one of this computer's works already answers.
        clashes: incoming.works.flatMap(({ name: workName, config }) =>
          existing
            .filter((other) => clash(config, other))
            .map((other) => ({ work: workName, path: config.path, with: `${projectNames.get(other.projectId) ?? ''} / ${other.name}` })),
        ),
      });
    }
    if (is('POST', 'projects')) {
      const name = text((await readJson(req)).name);
      if (!name || name.length > 100) refuse('the project needs a name');
      return send(res, 201, await db.createProject(name));
    }
    if (is('PATCH', 'projects', { withId: true })) {
      const body = await readJson(req);
      const changes = {};
      if (body.name !== undefined) {
        changes.name = text(body.name);
        if (!changes.name || changes.name.length > 100) refuse('the project needs a name');
      }
      if (body.tokenFields !== undefined) changes.tokenFields = tokenFieldsFrom(body.tokenFields);
      return send(res, 200, await db.updateProject(id, changes));
    }
    if (is('DELETE', 'projects', { withId: true })) {
      await db.deleteProject(id);
      await engine.reload();
      return send(res, 204);
    }

    if (is('GET', 'works')) return send(res, 200, await db.works());
    if (is('POST', 'works')) {
      const body = await readJson(req);
      if (!UUID.test(text(body.projectId))) refuse('the work has to be in a project');
      const { name, config } = workFrom(body, engine.plugins.registry);
      const work = await db.createWork(body.projectId, name, config);
      await engine.reload();
      return send(res, 201, work);
    }
    if (is('PUT', 'works', { withId: true })) {
      const { name, config } = workFrom(await readJson(req), engine.plugins.registry);
      const work = await db.updateWork(id, name, config);
      await engine.reload();
      return send(res, 200, work);
    }
    // The "try it" page: one request, through the gateway or straight to the
    // work's destination, and everything that came back.
    if (is('POST', 'works', { wantedAction: 'send' })) {
      const work = (await db.works()).find((candidate) => candidate.id === id);
      if (!work) throw new Refusal(404, 'no such work');
      return send(res, 200, await sendFor(work, await readJson(req)));
    }
    if (is('DELETE', 'works', { withId: true })) {
      await db.deleteWork(id);
      await engine.reload();
      return send(res, 204);
    }

    // --- the plugins this computer has ---

    const pluginsShown = () => ({
      folder: engine.plugins.registry.dir ?? null,
      canOpenFolder: Boolean(engine.plugins.openFolder),
      plugins: engine.plugins.registry.list().map(describePlugin),
      errors: engine.plugins.registry.errors(),
    });
    if (is('GET', 'plugins')) return send(res, 200, pluginsShown());
    if (method === 'POST' && resource === 'plugins' && id === 'reload' && !action) {
      await engine.plugins.reload();
      return send(res, 200, pluginsShown());
    }
    if (method === 'POST' && resource === 'plugins' && id === 'open' && !action) {
      if (!engine.plugins.openFolder) throw new Refusal(501, 'this KongGate has no window to open the folder in');
      await engine.plugins.openFolder();
      return send(res, 204);
    }

    // --- the administrator and the secrets: in the shared database, or in the data file ---

    if (!['admin', 'login', 'secrets'].includes(resource)) throw new Refusal(404, 'no such call');
    const kept = engine.secretsStore();

    if (is('GET', 'admin')) return send(res, 200, { passwordSet: Boolean(await kept.adminPassword()) });
    if (method === 'POST' && resource === 'admin' && id === 'password') {
      const body = await readJson(req);
      await engine.sessions.setPassword(kept, body.password, body.current);
      return send(res, 204);
    }
    if (is('POST', 'login')) {
      const body = await readJson(req);
      return send(res, 200, await engine.sessions.signIn(kept, body.password));
    }

    if (is('GET', 'secrets')) return send(res, 200, await kept.secrets());
    if (is('POST', 'secrets')) {
      adminOnly(req);
      const secret = secretFrom(await readJson(req), { partial: false });
      checkSecretValue(secret.algorithm, secret.value, secret.valueIsBase64);
      const created = await kept.createSecret(secret);
      await engine.reload();
      return send(res, 201, created);
    }
    if (is('PATCH', 'secrets', { withId: true })) {
      adminOnly(req);
      const changes = secretFrom(await readJson(req), { partial: true });
      // A new value is checked against the algorithm it will be used with.
      if (changes.value !== undefined) {
        const algorithm = changes.algorithm ?? (await kept.secrets()).find((secret) => secret.id === id)?.algorithm;
        if (algorithm) checkSecretValue(algorithm, changes.value, changes.valueIsBase64);
      }
      const updated = await kept.updateSecret(id, changes);
      await engine.reload();
      return send(res, 200, updated);
    }
    if (is('DELETE', 'secrets', { withId: true })) {
      adminOnly(req);
      // Only this computer's works can be asked; other computers' are their own.
      const inUse = db.worksUsing(id);
      if (inUse > 0) throw new Refusal(409, `the secret is used by ${inUse} work(s)`, { in_use: inUse });
      await kept.deleteSecret(id);
      await engine.reload();
      return send(res, 204);
    }

    throw new Refusal(404, 'no such call');
  }

  return function handle(req, res) {
    const url = new URL(req.url, 'http://app');
    const { pathname } = url;

    // The echo service: what the gateway itself calls, as any destination.
    if (pathname === '/echo' || pathname.startsWith('/echo/')) return echo(req, res, pathname);

    if (!comesFromTheApp(req)) {
      req.resume();
      return send(res, 403, { message: 'only the app itself may call this' });
    }

    // The "try it" dialog's door to the gateway: same origin as the app, so
    // the window needs no permission to call it.
    if (pathname === '/try' || pathname.startsWith('/try/')) {
      req.url = req.url.slice('/try'.length) || '/';
      return engine.gateway(req, res);
    }

    if (pathname.startsWith('/api/')) {
      route(req, res, pathname, url.searchParams).catch((error) => {
        if (res.headersSent) return res.destroy();
        if (error instanceof Refusal) return send(res, error.status, { message: error.message, ...error.extra });

        // The secrets' database went away in the middle of things.
        const failure = describeConnectionError(error);
        if (failure.reason !== 'other') return send(res, 503, { message: failure.message, reason: failure.reason });

        engine.report(error);
        return send(res, 500, { message: 'something went wrong; see the app\'s log' });
      });
      return undefined;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { message: 'not allowed' });
    return serveUi(res, engine.uiDir, pathname);
  };
}
