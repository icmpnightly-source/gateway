// What the app's own window talks to: the API behind every screen, the built
// UI's files, a door to the gateway for the "try it" dialog, and an echo
// service to point a first work at. Served to this computer only.

import { createPublicKey } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Refusal, describeConnectionError } from './db.mjs';
import { ALGORITHMS, decodeBase64Url, isHmac } from './jwt.mjs';

const MAX_BODY = 1024 * 1024;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const NAME = /^[\p{L}\p{N}._~-]+$/u;
const PATH = /^\/(?!.*\/\/)[^\s?#]*$/;
const HEADER = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
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

// --- what a work may hold ------------------------------------------------------

const refuse = (message) => {
  throw new Refusal(400, message);
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);
const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

function whole(value, { min, max, fallback }) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function headerName(value, what, { optional = false } = {}) {
  const name = text(value);
  if (name === '' && optional) return '';
  if (!HEADER.test(name)) refuse(`${what}: "${name}" is not a header name`);
  return name;
}

/**
 * A work as it is stored, from whatever was sent: every field present and of
 * its kind, so the gateway never has to doubt what it reads.
 */
export function workFrom(input) {
  const name = text(input?.name);
  if (!NAME.test(name)) refuse('the name may hold letters, digits, dots, dashes and underscores');

  const workPath = text(input?.path);
  if (!PATH.test(workPath)) refuse('the path has to start with "/" and hold no spaces, "?" or "#"');

  const methods = [...new Set(list(input?.methods))];
  if (methods.some((method) => !METHODS.includes(method))) refuse('unknown method');

  const destination = text(input?.destination);
  let url;
  try {
    url = new URL(destination);
  } catch {
    refuse('the destination is not a full address');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    refuse('the destination has to be an http:// or https:// address without "?" or "#"');
  }

  const token = input?.token ?? {};
  const verify = token.verify ?? {};
  const secretId = text(verify.secretId);
  if (secretId && !UUID.test(secretId)) refuse('unknown secret');
  if (flag(token.enabled, true) && flag(verify.enabled, false) && !secretId) {
    refuse('choose the secret tokens are verified against');
  }

  const rateLimit = input?.rateLimit ?? {};
  const limitBy = rateLimit.by === 'header' ? 'header' : 'ip';
  const limitHeader = headerName(rateLimit.header, 'request limit', { optional: true });
  if (flag(rateLimit.enabled, false) && limitBy === 'header' && !limitHeader) {
    refuse('name the header requests are counted by');
  }

  const requestId = input?.requestId ?? {};
  const tracing = input?.tracing ?? {};
  const cors = input?.cors ?? {};
  const origins = list(cors.origins).map(text).filter(Boolean);

  const config = {
    path: workPath,
    methods,
    destination,
    stripPath: flag(input?.stripPath, true),
    timeoutSeconds: whole(input?.timeoutSeconds, { min: 1, max: 600, fallback: 30 }),
    headers: list(input?.headers).map((header) => {
      const value = typeof header?.value === 'string' ? header.value : '';
      if (value.trim() === '' || CONTROL.test(value)) refuse('a fixed header needs a value, on one line');
      return { name: headerName(header?.name, 'fixed header'), value };
    }),
    token: {
      enabled: flag(token.enabled, true),
      header: headerName(token.header || 'Authorization', 'token header'),
      claims: list(token.claims).map((mapping) => {
        const claim = text(mapping?.claim);
        if (!claim) refuse('a token field to forward has no name');
        return { claim, header: headerName(mapping?.header, `header for "${claim}"`), required: flag(mapping?.required, false) };
      }),
      payloadHeader: headerName(token.payloadHeader, 'payload header', { optional: true }),
      forwardToken: flag(token.forwardToken, true),
      strict: flag(token.strict, true),
      conditions: list(token.conditions).map((condition) => {
        const claim = text(condition?.claim);
        const values = list(condition?.values).map((value) => String(value)).filter((value) => value !== '');
        if (!claim || values.length === 0) refuse('a condition needs a token field and at least one value');
        return { claim, values };
      }),
      verify: {
        enabled: flag(verify.enabled, false),
        secretId,
        checkExpiry: flag(verify.checkExpiry, true),
        leeway: whole(verify.leeway, { min: 0, max: 86400, fallback: 0 }),
        issuer: text(verify.issuer),
        audience: text(verify.audience),
      },
    },
    requestId: {
      enabled: flag(requestId.enabled, false),
      header: headerName(requestId.header || 'X-Request-Id', 'request id header'),
      echo: flag(requestId.echo, true),
    },
    tracing: {
      enabled: flag(tracing.enabled, false),
      samplingPercent: whole(tracing.samplingPercent, { min: 0, max: 100, fallback: 100 }),
      body: flag(tracing.body, false),
    },
    rateLimit: {
      enabled: flag(rateLimit.enabled, false),
      perMinute: whole(rateLimit.perMinute, { min: 1, max: 1000000, fallback: 60 }),
      by: limitBy,
      header: limitHeader,
    },
    cors: {
      enabled: flag(cors.enabled, false),
      origins: origins.length > 0 ? origins : ['*'],
      credentials: flag(cors.credentials, false),
    },
  };

  return { name, config };
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
 * `engine` is what index.mjs builds: the settings, the database, the sessions
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
    if (method === 'POST' && resource === 'settings' && id === 'test') {
      const body = await readJson(req);
      return send(res, 200, await engine.testDatabase(body.database ?? {}));
    }
    if (is('PUT', 'settings')) {
      await engine.applySettings(await readJson(req));
      return send(res, 200, engine.status());
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

    // --- the shared configuration ---

    const db = engine.database();

    if (is('GET', 'projects')) return send(res, 200, await db.projects());
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
      if (body.tokenFields !== undefined) {
        changes.tokenFields = list(body.tokenFields)
          .filter((field) => text(field?.path) && TOKEN_FIELD_TYPES.includes(field?.type))
          .map((field) => ({ path: text(field.path), type: field.type }));
      }
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
      const { name, config } = workFrom(body);
      const work = await db.createWork(body.projectId, name, config);
      await engine.reload();
      return send(res, 201, work);
    }
    if (is('PUT', 'works', { withId: true })) {
      const { name, config } = workFrom(await readJson(req));
      const work = await db.updateWork(id, name, config);
      await engine.reload();
      return send(res, 200, work);
    }
    if (is('DELETE', 'works', { withId: true })) {
      await db.deleteWork(id);
      await engine.reload();
      return send(res, 204);
    }

    // --- the administrator and the secrets ---

    if (is('GET', 'admin')) return send(res, 200, { passwordSet: Boolean(await db.adminPassword()) });
    if (method === 'POST' && resource === 'admin' && id === 'password') {
      const body = await readJson(req);
      await engine.sessions.setPassword(db, body.password, body.current);
      return send(res, 204);
    }
    if (is('POST', 'login')) {
      const body = await readJson(req);
      return send(res, 200, await engine.sessions.signIn(db, body.password));
    }

    if (is('GET', 'secrets')) return send(res, 200, await db.secrets());
    if (is('POST', 'secrets')) {
      adminOnly(req);
      const secret = secretFrom(await readJson(req), { partial: false });
      checkSecretValue(secret.algorithm, secret.value, secret.valueIsBase64);
      const created = await db.createSecret(secret);
      await engine.reload();
      return send(res, 201, created);
    }
    if (is('PATCH', 'secrets', { withId: true })) {
      adminOnly(req);
      const changes = secretFrom(await readJson(req), { partial: true });
      // A new value is checked against the algorithm it will be used with.
      if (changes.value !== undefined) {
        const algorithm = changes.algorithm ?? (await db.secrets()).find((secret) => secret.id === id)?.algorithm;
        if (algorithm) checkSecretValue(algorithm, changes.value, changes.valueIsBase64);
      }
      const updated = await db.updateSecret(id, changes);
      await engine.reload();
      return send(res, 200, updated);
    }
    if (is('DELETE', 'secrets', { withId: true })) {
      adminOnly(req);
      await db.deleteSecret(id);
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

        // The database went away in the middle of things.
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
