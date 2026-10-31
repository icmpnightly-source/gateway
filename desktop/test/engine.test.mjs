// Exercises the whole engine through the same doors everything else uses:
// the app's API, the gateway's port and the command line. Everything it
// writes goes into a temporary folder that is removed at the end.
//
//   node test/engine.test.mjs
//
// The part about secrets kept in a shared database runs only when it is given
// a PostgreSQL database nobody uses (its kg_ tables are dropped):
//   KONGGATE_TEST_DB=postgres://user:password@host:port/database

import { execFile } from 'node:child_process';
import { createHmac, generateKeyPairSync, sign as signWith, constants } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { startEngine } from '../engine/index.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64url = (value) => Buffer.from(value).toString('base64url');

let passed = 0;
let failed = 0;
function expect(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
}

// --- a destination that says what it was sent ---------------------------------

const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    if (req.url.startsWith('/slow')) await sleep(3000);
    if (req.url.startsWith('/drop')) return void req.socket.destroy();

    const body = JSON.stringify({
      method: req.method,
      url: req.url,
      headers: req.headers,
      // As bytes arrived, read as UTF-8: how a real service would read them.
      utf8: Object.fromEntries(
        Object.entries(req.headers).map(([name, value]) => [name, Buffer.from(String(value), 'latin1').toString('utf8')]),
      ),
      body: Buffer.concat(chunks).toString('utf8'),
    });
    const compressed = req.url.startsWith('/gzip');
    res.writeHead(req.url.startsWith('/teapot') ? 418 : 200, {
      'Content-Type': 'application/json',
      'Set-Cookie': ['a=1', 'b=2'],
      'X-From-Destination': 'yes',
      ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(compressed ? gzipSync(body) : body);
  });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const DESTINATION = `http://127.0.0.1:${upstream.address().port}`;

// A port nothing listens on.
const closed = http.createServer();
await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
const CLOSED = `http://127.0.0.1:${closed.address().port}`;
await new Promise((resolve) => closed.close(resolve));

// --- two engines, each with a folder of its own: two computers ------------------

const scratch = mkdtempSync(path.join(os.tmpdir(), 'konggate-test-'));

// What the desktop app does with a secret's value before it goes to disk,
// reduced to something a test can see through.
const vault = {
  seal: (plain) => `test:${Buffer.from(plain, 'utf8').toString('hex')}`,
  open: (sealed) => (sealed.startsWith('test:') ? Buffer.from(sealed.slice(5), 'hex').toString('utf8') : null),
};

async function engineOn(name, gatewayPort, appPort, release = {}) {
  const folder = path.join(scratch, name);
  mkdirSync(folder, { recursive: true });
  const settingsFile = path.join(folder, 'settings.json');
  const dataFile = path.join(folder, 'data.json');
  writeFileSync(settingsFile, JSON.stringify({ gateway: { port: gatewayPort, public: false }, app: { port: appPort } }));

  const engine = await startEngine({ settingsFile, dataFile, vault, uiDir: path.join(scratch, 'no-ui'), report: () => undefined, ...release });
  return { engine, app: engine.url, gateway: `http://127.0.0.1:${gatewayPort}`, dataFile };
}

let one = await engineOn('one', 18100, 18101);
const two = await engineOn('two', 18200, 18201);

async function call(base, method, url, body, headers = {}) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, raw, headers: response.headers };
}
const api = (method, url, body, headers) => call(one.app, method, `/api${url}`, body, headers);
const through = (method, url, { headers, body } = {}) => call(one.gateway, method, url, body, headers);

function hsToken(payload, secret, { alg = 'HS256', hash = 'sha256' } = {}) {
  const signed = `${b64url(JSON.stringify({ alg, typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${signed}.${createHmac(hash, secret).update(signed).digest('base64url')}`;
}
function keyToken(payload, alg, privateKey, options) {
  const signed = `${b64url(JSON.stringify({ alg, typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const hash = alg === 'EdDSA' ? null : `sha${alg.slice(2)}`;
  return `${signed}.${signWith(hash, Buffer.from(signed), { key: privateKey, ...options }).toString('base64url')}`;
}
const unsigned = (payload) => `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(payload))}.`;

const work = (overrides = {}) => ({
  name: 'w',
  path: '/w',
  methods: [],
  destination: DESTINATION,
  stripPath: true,
  timeoutSeconds: 30,
  headers: [],
  token: { enabled: false },
  ...overrides,
});

let session;

try {
  console.log('# this computer');
  let r = await api('GET', '/status');
  expect('status: the gateway runs, and the data file is named', [r.status, r.json.gateway.running, r.json.gateway.port, r.json.dataFile], [200, true, 18100, one.dataFile]);
  expect('an engine nobody built has no build day', r.json.buildDate, null);
  r = await api('GET', '/settings');
  expect('settings: the gateway\'s port and who may call it', r.json.gateway, { port: 18100, public: false });
  expect('what closing the window means starts as a question', r.json.window, { onClose: 'ask' });
  expect('at first the secrets are kept in this computer\'s file', [r.json.database.host, (await api('GET', '/status')).json.database.used], ['', false]);

  console.log('\n# only the app may call the API');
  r = await api('GET', '/status', undefined, { Origin: 'http://evil.example' });
  expect('a call from another site is turned away', r.status, 403);
  r = await api('GET', '/status', undefined, { 'Sec-Fetch-Site': 'cross-site' });
  expect('a cross-site call is turned away', r.status, 403);
  r = await api('POST', '/projects', { name: 'x' }, { Origin: 'http://localhost:9999' });
  expect('a write from another origin is turned away', r.status, 403);

  console.log('\n# projects');
  const suffix = Date.now().toString(36);
  r = await api('POST', '/projects', { name: `test-${suffix}` });
  expect('a project is created', [r.status, r.json.name, r.json.tokenFields], [201, `test-${suffix}`, []]);
  const projectId = r.json.id;
  r = await api('POST', '/projects', { name: `test-${suffix}` });
  expect('a second one by the same name is refused', r.status, 409);
  r = await api('PATCH', `/projects/${projectId}`, { tokenFields: [{ path: 'id', type: 'number' }, { path: 'bad', type: 'nonsense' }] });
  expect('a project remembers its token fields', [r.status, r.json.tokenFields], [200, [{ path: 'id', type: 'number' }]]);

  const addWork = async (overrides) => {
    const response = await api('POST', '/works', { projectId, ...work(overrides) });
    if (response.status !== 201) throw new Error(`could not create a work: ${response.raw}`);
    return response.json;
  };

  console.log('\n# forwarding');
  const plain = await addWork({ name: 'plain', path: '/plain' });
  expect('a work comes back whole', [plain.name, plain.path, plain.token.enabled, plain.rateLimit.perMinute, plain.cors.origins], ['plain', '/plain', false, 60, ['*']]);
  r = await api('POST', '/works', { projectId, ...work({ name: 'plain', path: '/other' }) });
  expect('a second work by the same name is refused', r.status, 409);
  r = await api('POST', '/works', { projectId, ...work({ name: 'bad', path: 'no-slash' }) });
  expect('a path without a slash is refused', r.status, 400);
  r = await api('POST', '/works', { projectId, ...work({ name: 'bad', path: '/bad', destination: 'ftp://x' }) });
  expect('a destination that is not http is refused', r.status, 400);
  r = await api('POST', '/works', { projectId, ...work({ name: 'bad', path: '/bad', headers: [{ name: 'X-A', value: 'a\r\nX-B: b' }] }) });
  expect('a header value over two lines is refused', r.status, 400);

  r = await through('GET', '/plain/users/7?page=2&q=a%20b');
  expect('the path after the work\'s goes on, with the query', [r.status, r.json.url], [200, '/users/7?page=2&q=a%20b']);
  expect('the destination is told who asked', [r.json.headers['x-forwarded-for'], r.json.headers['x-forwarded-prefix'], r.json.headers['x-forwarded-path'], r.json.headers.host], ['127.0.0.1', '/plain', '/plain/users/7', DESTINATION.slice(7)]);
  expect('the destination\'s own headers come back, repeated ones too', [r.headers.get('x-from-destination'), r.headers.getSetCookie(), r.headers.get('via')], ['yes', ['a=1', 'b=2'], '1.1 konggate']);
  r = await through('GET', '/plain');
  expect('the bare path goes to the destination\'s root', r.json.url, '/');
  r = await through('GET', '/plainer');
  expect('a path that only starts alike is not the work\'s', [r.status, r.json.reason], [404, 'no_work']);
  r = await through('POST', '/plain/teapot', { body: { hello: 'world' } });
  expect('status and body pass through both ways', [r.status, r.json.method, r.json.body], [418, 'POST', '{"hello":"world"}']);

  await addWork({ name: 'kept', path: '/kept', stripPath: false, destination: `${DESTINATION}/base` });
  r = await through('GET', '/kept/a');
  expect('without stripping, the whole path follows the destination\'s own', r.json.url, '/base/kept/a');
  await addWork({ name: 'deeper', path: '/plain/deep', methods: ['POST'] });
  r = await through('POST', '/plain/deep/x');
  expect('the longer path wins', r.json.url, '/x');
  r = await through('GET', '/plain/deep/x');
  expect('a method the longer one does not take falls to the shorter', r.json.url, '/deep/x');

  console.log('\n# the token, read without checking');
  await addWork({
    name: 'token',
    path: '/token',
    token: {
      enabled: true,
      claims: [
        { claim: 'id', header: 'X-User-Id', required: true },
        { claim: 'username', header: 'X-User-Name', required: false },
        { claim: 'user.roles', header: 'X-Roles', required: false },
      ],
      payloadHeader: 'X-Payload',
    },
  });
  const claims = { id: 129, username: 'Алишер', user: { roles: ['admin', 'dev'] } };
  r = await through('GET', '/token', { headers: { Authorization: `Bearer ${unsigned(claims)}`, 'X-User-Id': '1' } });
  expect('chosen fields arrive as headers, over what the client sent', [r.status, r.json.headers['x-user-id'], r.json.headers['x-roles']], [200, '129', '["admin","dev"]']);
  expect('text beyond ASCII arrives as UTF-8', r.json.utf8['x-user-name'], 'Алишер');
  expect('the payload and the token go along', [r.json.headers['x-payload'], r.json.headers.authorization], [b64url(JSON.stringify(claims)), `Bearer ${unsigned(claims)}`]);
  r = await through('GET', '/token', { headers: { 'X-User-Id': '1' } });
  expect('no token: 401', [r.status, r.json.message, r.headers.get('www-authenticate')], [401, 'Unauthorized: token is missing', 'Bearer']);
  r = await through('GET', '/token', { headers: { Authorization: `Bearer ${unsigned({ username: 'x' })}` } });
  expect('a required field missing: 401', [r.status, r.json.message], [401, "Unauthorized: token has no usable 'id' claim"]);
  r = await through('GET', '/token', { headers: { Authorization: 'Bearer not-a-token' } });
  expect('not a JWT: 401', [r.status, r.json.message], [401, 'Unauthorized: token is not a JWT']);

  await addWork({
    name: 'loose',
    path: '/loose',
    token: { enabled: true, strict: false, forwardToken: false, claims: [{ claim: 'id', header: 'X-User-Id', required: false }] },
  });
  r = await through('GET', '/loose', { headers: { 'X-User-Id': 'forged' } });
  expect('not strict: let through, without the client\'s own header', [r.status, r.json.headers['x-user-id']], [200, undefined]);
  r = await through('GET', '/loose', { headers: { Authorization: `Bearer ${unsigned({ id: 5 })}` } });
  expect('the token can be kept from the destination', [r.json.headers['x-user-id'], r.json.headers.authorization], ['5', undefined]);

  await addWork({
    name: 'gated',
    path: '/gated',
    token: { enabled: true, strict: false, conditions: [{ claim: 'user.roles', values: ['admin'] }] },
  });
  r = await through('GET', '/gated', { headers: { Authorization: `Bearer ${unsigned(claims)}` } });
  expect('a condition met by one item of a list', r.status, 200);
  r = await through('GET', '/gated', { headers: { Authorization: `Bearer ${unsigned({ user: { roles: ['dev'] } })}` } });
  expect('a condition not met: 403', [r.status, r.json.reason], [403, 'condition']);
  r = await through('GET', '/gated');
  expect('a gated work cannot be entered without a token, strict or not', r.status, 401);

  console.log('\n# the administrator and the secrets');
  r = await api('GET', '/secrets');
  expect('anyone may list the secrets', r.status, 200);
  r = await api('POST', '/secrets', { name: 'x', algorithm: 'HS256', value: 'v' });
  expect('nobody adds one without signing in', r.status, 401);

  const password = `pw-${suffix}-long`;
  r = await api('GET', '/admin');
  expect('at first there is no administrator password', r.json.passwordSet, false);
  r = await api('POST', '/admin/password', { password: 'short' });
  expect('a short first password is refused', r.status, 400);
  r = await api('POST', '/admin/password', { password });
  expect('the first password is set by whoever comes first', r.status, 204);
  r = await api('POST', '/admin/password', { password: 'another-password' });
  expect('after that it takes the current one', r.status, 401);
  r = await api('POST', '/login', { password: 'wrong-password' });
  expect('a wrong password: 401', r.status, 401);
  r = await api('POST', '/login', { password });
  expect('the right one opens a session', [r.status, typeof r.json.token], [200, 'string']);
  session = { Authorization: `Bearer ${r.json.token}` };
  r = await call(two.app, 'POST', '/api/secrets', { name: 'x', algorithm: 'HS256', value: 'v' }, session);
  expect('a session opened on one computer is not one on another', r.status, 401);

  const addSecret = async (body) => {
    const response = await api('POST', '/secrets', body, session);
    if (response.status !== 201) throw new Error(`could not add a secret: ${response.raw}`);
    return response.json;
  };

  const hs = await addSecret({ name: `hs-${suffix}`, algorithm: 'HS256', value: 'the shared secret' });
  expect('a secret comes back without its value', Object.keys(hs).sort(), ['algorithm', 'createdAt', 'hasValue', 'id', 'name']);
  r = await api('GET', '/secrets');
  expect('nor does the list hold values', r.raw.includes('the shared secret'), false);
  r = await api('POST', '/secrets', { name: `hs-${suffix}`, algorithm: 'HS256', value: 'v' }, session);
  expect('a second secret by the same name is refused', r.status, 409);
  r = await api('POST', '/secrets', { name: `bad-${suffix}`, algorithm: 'RS256', value: 'not a key' }, session);
  expect('a public key that is not one is refused', r.status, 400);

  console.log('\n# the token, verified');
  await addWork({
    name: 'verified',
    path: '/verified',
    token: {
      enabled: true,
      claims: [{ claim: 'id', header: 'X-User-Id', required: true }],
      verify: { enabled: true, secretId: hs.id, checkExpiry: true, leeway: 0, issuer: 'me', audience: 'api' },
    },
  });
  const now = Math.floor(Date.now() / 1000);
  const good = { id: 7, iss: 'me', aud: ['web', 'api'], exp: now + 600 };
  const verifiedWith = (token) => through('GET', '/verified', { headers: { Authorization: `Bearer ${token}` } });
  r = await verifiedWith(hsToken(good, 'the shared secret'));
  expect('a properly signed token passes', [r.status, r.json.headers['x-user-id']], [200, '7']);
  r = await verifiedWith(hsToken(good, 'another secret'));
  expect('signed with something else: 401', [r.status, r.json.message], [401, 'Unauthorized: token signature is invalid']);
  r = await verifiedWith(unsigned(good));
  expect('"alg: none": 401', [r.status, r.json.message], [401, 'Unauthorized: token is not signed with HS256']);
  r = await verifiedWith(hsToken(good, 'the shared secret', { alg: 'HS512', hash: 'sha512' }));
  expect('another algorithm than the secret\'s: 401', r.status, 401);
  r = await verifiedWith(hsToken({ ...good, exp: now - 5 }, 'the shared secret'));
  expect('expired: 401', [r.status, r.json.message], [401, 'Unauthorized: token has expired']);
  r = await verifiedWith(hsToken({ ...good, nbf: now + 600 }, 'the shared secret'));
  expect('not valid yet: 401', r.json.message, 'Unauthorized: token is not valid yet');
  r = await verifiedWith(hsToken({ ...good, iss: 'someone' }, 'the shared secret'));
  expect('another issuer: 401', r.json.message, 'Unauthorized: token issuer is not accepted');
  r = await verifiedWith(hsToken({ ...good, aud: 'web' }, 'the shared secret'));
  expect('another audience: 401', r.json.message, 'Unauthorized: token audience is not accepted');

  r = await api('DELETE', `/secrets/${hs.id}`, undefined, session);
  expect('a secret in use is not deleted', [r.status, r.json.in_use], [409, 1]);
  r = await api('PATCH', `/secrets/${hs.id}`, { name: `hs-${suffix}-renamed`, algorithm: 'HS256' }, session);
  expect('a secret is renamed without its value', [r.status, r.json.name], [200, `hs-${suffix}-renamed`]);
  r = await verifiedWith(hsToken(good, 'the shared secret'));
  expect('and still verifies', r.status, 200);
  r = await api('PATCH', `/secrets/${hs.id}`, { name: `hs-${suffix}-renamed`, algorithm: 'HS256', value: Buffer.from('new secret').toString('base64'), valueIsBase64: true }, session);
  r = await verifiedWith(hsToken(good, 'new secret'));
  expect('a replaced value, given as base64, takes over', r.status, 200);
  r = await verifiedWith(hsToken(good, 'the shared secret'));
  expect('and the old one stops working', r.status, 401);

  const keyCases = [
    ['RS256', generateKeyPairSync('rsa', { modulusLength: 2048 }), {}],
    ['PS384', generateKeyPairSync('rsa', { modulusLength: 2048 }), { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }],
    ['ES256', generateKeyPairSync('ec', { namedCurve: 'P-256' }), { dsaEncoding: 'ieee-p1363' }],
    ['ES512', generateKeyPairSync('ec', { namedCurve: 'P-521' }), { dsaEncoding: 'ieee-p1363' }],
    ['EdDSA', generateKeyPairSync('ed25519'), {}],
  ];
  for (const [alg, pair, options] of keyCases) {
    const secret = await addSecret({ name: `${alg}-${suffix}`, algorithm: alg, value: pair.publicKey.export({ type: 'spki', format: 'pem' }) });
    const pathOf = `/key-${alg.toLowerCase()}`;
    await addWork({ name: `key-${alg}`, path: pathOf, token: { enabled: true, verify: { enabled: true, secretId: secret.id } } });

    r = await through('GET', pathOf, { headers: { Authorization: `Bearer ${keyToken({ id: 1 }, alg, pair.privateKey, options)}` } });
    const other = alg.startsWith('E') && alg !== 'EdDSA'
      ? generateKeyPairSync('ec', { namedCurve: alg === 'ES256' ? 'P-256' : 'P-521' })
      : alg === 'EdDSA' ? generateKeyPairSync('ed25519') : generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = await through('GET', pathOf, { headers: { Authorization: `Bearer ${keyToken({ id: 1 }, alg, other.privateKey, options)}` } });
    expect(`${alg}: the key's own signature passes, another's does not`, [r.status, forged.status], [200, 401]);
  }

  console.log('\n# fixed headers, request id, request limit, CORS');
  await addWork({
    name: 'extras',
    path: '/extras',
    headers: [{ name: 'X-Source', value: 'шлюз' }],
    requestId: { enabled: true, header: 'X-Request-Id', echo: true },
  });
  r = await through('GET', '/extras', { headers: { 'X-Source': 'client' } });
  expect('a fixed header replaces the client\'s', r.json.utf8['x-source'], 'шлюз');
  expect('a request id is made and returned', [/^[0-9a-f-]{36}$/.test(r.json.headers['x-request-id']), r.headers.get('x-request-id')], [true, r.json.headers['x-request-id']]);
  r = await through('GET', '/extras', { headers: { 'X-Request-Id': 'mine' } });
  expect('the client\'s own id is kept', [r.json.headers['x-request-id'], r.headers.get('x-request-id')], ['mine', 'mine']);

  await addWork({ name: 'limited', path: '/limited', rateLimit: { enabled: true, perMinute: 2, by: 'header', header: 'X-Who' } });
  const statuses = [];
  for (const who of ['a', 'a', 'a', 'b']) statuses.push((await through('GET', '/limited', { headers: { 'X-Who': who } })).status);
  expect('the third request of one caller is over the limit, another caller\'s is not', statuses, [200, 200, 429, 200]);
  r = await through('GET', '/limited', { headers: { 'X-Who': 'a' } });
  expect('the answer says when to come back', [r.json.reason, r.headers.get('ratelimit-remaining'), Number(r.headers.get('retry-after')) > 0], ['rate_limit', '0', true]);

  await addWork({
    name: 'browser',
    path: '/browser',
    methods: ['POST'],
    cors: { enabled: true, origins: ['https://app.example'], credentials: true },
    token: { enabled: true },
  });
  r = await through('OPTIONS', '/browser', { headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
  expect('a preflight is answered by the gateway, before any token', [r.status, r.headers.get('access-control-allow-origin'), r.headers.get('access-control-allow-methods'), r.headers.get('access-control-allow-headers'), r.headers.get('access-control-allow-credentials')], [200, 'https://app.example', 'POST', 'authorization', 'true']);
  r = await through('OPTIONS', '/browser', { headers: { Origin: 'https://other.example', 'Access-Control-Request-Method': 'POST' } });
  expect('another origin is not named', r.headers.get('access-control-allow-origin'), null);
  r = await through('POST', '/browser', { headers: { Origin: 'https://app.example' } });
  expect('even a refusal carries the CORS headers, so the browser can read it', [r.status, r.headers.get('access-control-allow-origin')], [401, 'https://app.example']);
  r = await through('OPTIONS', '/browser', { headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' } });
  expect('a preflight answer is remembered for a while, and lets a page reach a LAN address', [r.headers.get('access-control-max-age'), r.headers.get('access-control-allow-private-network')], ['600', 'true']);
  r = await through('POST', '/browser', { headers: { Origin: 'https://app.example' } });
  expect('with credentials, the gateway\'s own headers are named for the page to read', r.headers.get('access-control-expose-headers')?.includes('RateLimit-Remaining'), true);

  await addWork({ name: 'open', path: '/open', methods: ['GET'], cors: { enabled: true, origins: ['*'] } });
  r = await through('GET', '/open', { headers: { Origin: 'http://192.168.1.13:3000' } });
  expect('any origin, no credentials: "*", and every header readable', [r.status, r.headers.get('access-control-allow-origin'), r.headers.get('access-control-expose-headers')], [200, '*', '*']);

  await addWork({ name: 'no-cors', path: '/no-cors', methods: ['GET'], token: { enabled: true } });
  r = await through('OPTIONS', '/no-cors', { headers: { Origin: 'http://192.168.1.13:3000', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  expect('with CORS off a preflight goes to the destination, past the token check', [r.status, r.json?.method, r.headers.get('access-control-allow-origin')], [200, 'OPTIONS', null]);
  r = await through('GET', '/no-cors', { headers: { Origin: 'http://192.168.1.13:3000' } });
  expect('and the request itself is still checked, with no CORS headers added', [r.status, r.headers.get('access-control-allow-origin')], [401, null]);

  console.log('\n# destinations that do not answer');
  await addWork({ name: 'refused', path: '/refused', destination: CLOSED });
  r = await through('GET', '/refused');
  expect('nothing listening: 502, and why', [r.status, r.json.reason], [502, 'refused']);
  await addWork({ name: 'slow', path: '/slow', timeoutSeconds: 1 });
  let started = Date.now();
  r = await through('GET', '/slow/slow');
  expect('no answer in time: 504, and why', [r.status, r.json.reason, Date.now() - started < 2500], [504, 'response_timeout', true]);
  await addWork({ name: 'silent', path: '/silent', destination: 'http://10.255.255.1:81', timeoutSeconds: 2 });
  started = Date.now();
  r = await through('GET', '/silent');
  expect('no connection in time: 504, and why', [r.status, r.json.reason, Date.now() - started < 4000], [504, 'connect_timeout', true]);
  await addWork({ name: 'nowhere', path: '/nowhere', destination: 'http://no-such-host.invalid:8000' });
  r = await through('GET', '/nowhere');
  expect('an unknown name: 503, and why', [r.status, r.json.reason], [503, 'unknown_host']);
  await addWork({ name: 'dropped', path: '/dropped' });
  r = await through('GET', '/dropped/drop');
  expect('a connection closed without an answer: 502, and why', [r.status, r.json.reason], [502, 'closed']);

  console.log('\n# the requests log');
  await addWork({
    name: 'logged',
    path: '/logged',
    tracing: { enabled: true, samplingPercent: 100, body: true },
    token: { enabled: true, claims: [{ claim: 'id', header: 'X-User-Id', required: false }] },
  });
  const loggedToken = unsigned({ id: 42 });
  r = await through('POST', '/logged/orders?x=1', { headers: { Authorization: `Bearer ${loggedToken}`, Cookie: 'sid=secret' }, body: { item: 'чай' } });
  const traceId = r.headers.get('x-trace-id');
  expect('a recorded request says under which id', [r.status, /^[0-9a-f]{32}$/.test(traceId ?? '')], [200, true]);
  await sleep(100);
  r = await api('GET', `/requests/${traceId}`);
  expect('the log holds what came in', [r.status, r.json.in.method, r.json.in.url.endsWith('/logged/orders?x=1'), r.json.in.body, r.json.status], [200, 'POST', true, '{"item":"чай"}', 200]);
  expect('and what went out', [r.json.out.url, r.json.out.headers['x-user-id'], r.json.out.status, r.json.out.ip], [`${DESTINATION}/orders?x=1`, '42', 200, '127.0.0.1']);
  expect('with the token and cookies masked', [r.json.in.headers.authorization, r.json.out.headers.authorization, r.json.in.headers.cookie, r.raw.includes(loggedToken)], ['Bearer ***', 'Bearer ***', '***', false]);
  expect('and what the destination answered', [r.json.out.response.status, r.json.out.response.headers['x-from-destination'], r.json.out.response.headers['set-cookie'], JSON.parse(r.json.out.response.body).url], [200, 'yes', '***, ***', '/orders?x=1']);
  expect('where even an answer repeating the token has it masked', JSON.parse(r.json.out.response.body).headers.authorization, 'Bearer ***');
  expect('and what the client was given', [r.json.answer.by, r.json.answer.headers.via, r.json.answer.headers['x-trace-id']], ['destination', '1.1 konggate', traceId]);

  r = await through('GET', '/logged/gzip', { headers: { Authorization: `Bearer ${loggedToken}` } });
  const gzipId = r.headers.get('x-trace-id');
  expect('a compressed answer reaches the client as it was', [r.status, r.json.url], [200, '/gzip']);
  await sleep(100);
  r = await api('GET', `/requests/${gzipId}`);
  expect('and is logged unpacked', [r.json.out.response.headers['content-encoding'], JSON.parse(r.json.out.response.body).url], ['gzip', '/gzip']);

  r = await through('GET', '/logged');
  const refusedId = r.headers.get('x-trace-id');
  await sleep(100);
  r = await api('GET', `/requests/${refusedId}`);
  expect('a request the gateway turned down is logged as never sent', [r.json.status, r.json.out.sent], [401, false]);
  expect('with the gateway\'s own answer', [r.json.answer.by, JSON.parse(r.json.answer.body).reason], ['gateway', 'token']);
  r = await api('GET', '/requests?limit=5');
  expect('the list is newest first, and says who answered', [r.json[0].id, r.json[0].status, r.json[0].answeredBy, r.json[1].id, r.json[1].answeredBy, r.json[2].id], [refusedId, 401, 'gateway', gzipId, 'destination', traceId]);

  console.log('\n# the app\'s own doors');
  r = await call(one.app, 'GET', '/try/plain/from-the-app');
  expect('the "try it" door leads to the gateway', [r.status, r.json.url], [200, '/from-the-app']);
  r = await call(one.app, 'POST', '/echo/hello?x=1', { a: 1 });
  expect('the echo service says what it was sent', [r.status, r.json.method, r.json.path, r.json.body], [200, 'POST', '/hello', '{"a":1}']);

  console.log('\n# trying a work out');
  const send = (workId, body) => api('POST', `/works/${workId}/send`, body);
  r = await send(plain.id, {
    via: 'gateway',
    method: 'POST',
    path: '/plain/try?x=1',
    headers: [{ name: 'X-Mine', value: 'salom' }, { name: 'Content-Type', value: 'application/json' }],
    body: '{"a":1}',
  });
  let seen = JSON.parse(r.json.body.text);
  expect('a request goes through the gateway as it was asked for', [r.status, r.json.status, seen.method, seen.url, seen.headers['x-mine'], seen.body, seen.headers['x-forwarded-path']], [200, 200, 'POST', '/try?x=1', 'salom', '{"a":1}', '/plain/try']);
  expect('carrying nothing of the page that asked', [seen.headers.referer, seen.headers['sec-fetch-site'], seen.headers['user-agent'].startsWith('KongGate/')], [undefined, undefined, true]);
  expect('and its answer comes back whole', [r.json.statusText, r.json.body.kind, r.json.body.truncated, r.json.headers.some(([name, value]) => name.toLowerCase() === 'x-from-destination' && value === 'yes'), r.json.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').length, typeof r.json.ms], ['OK', 'text', false, true, 2, 'number']);

  r = await send(plain.id, { via: 'direct', method: 'GET', path: '/plain/straight?y=2', headers: [] });
  seen = JSON.parse(r.json.body.text);
  expect('or straight to the destination, on the path the gateway would take', [r.json.status, r.json.url, seen.url, seen.headers['x-forwarded-for'], seen.headers.via], [200, `${DESTINATION}/straight?y=2`, '/straight?y=2', undefined, undefined]);
  r = await send(plain.id, { via: 'direct', method: 'GET', path: '/plain/gzip', headers: [] });
  expect('a compressed answer is shown unpacked', [r.json.body.kind, JSON.parse(r.json.body.text).url], ['text', '/gzip']);
  r = await send(plain.id, { via: 'direct', method: 'HEAD', path: '/plain', headers: [] });
  expect('an answer without a body is told as empty', [r.json.status, r.json.body.kind], [200, 'empty']);

  const gone = await addWork({ name: 'send-gone', path: '/send-gone', destination: CLOSED });
  r = await send(gone.id, { via: 'direct', method: 'GET', path: '/send-gone', headers: [] });
  expect('a destination that is not there is told as such', [r.status, r.json.status, r.json.failed.reason], [200, undefined, 'refused']);
  r = await send(gone.id, { via: 'gateway', method: 'GET', path: '/send-gone', headers: [] });
  expect('through the gateway the same comes back as the gateway\'s answer', [r.json.status, JSON.parse(r.json.body.text).reason], [502, 'refused']);
  await api('DELETE', `/works/${gone.id}`);

  r = await send(plain.id, { via: 'gateway', method: 'GET', path: '/elsewhere', headers: [] });
  expect('a path that is not the work\'s is refused', r.status, 400);
  r = await send(plain.id, { via: 'gateway', method: 'GET', path: '/plain', headers: [{ name: 'Bad Name', value: 'x' }] });
  expect('so is a header that cannot be sent', r.status, 400);
  r = await send(plain.id, { via: 'gateway', method: 'FLY', path: '/plain', headers: [] });
  expect('and a method there is no such thing as', r.status, 400);
  r = await send('00000000-0000-4000-8000-000000000000', { via: 'gateway', method: 'GET', path: '/plain', headers: [] });
  expect('a work that is not there cannot be tried', r.status, 404);

  console.log('\n# each computer keeps its own');
  r = await call(two.app, 'GET', '/api/projects');
  expect('the other computer has none of this', r.json, []);
  r = await call(two.gateway, 'GET', '/plain/not-here');
  expect('nor does its gateway', r.status, 404);

  console.log('\n# a project as a file');
  r = await api('GET', `/projects/${projectId}/export`);
  const exported = r.json;
  expect('a project is exported with its works', [r.status, exported.konggate, exported.project.name, exported.works.length > 10, exported.works.some((item) => 'id' in item || 'projectId' in item)], [200, 1, `test-${suffix}`, true, false]);
  const exportedVerified = exported.works.find((item) => item.name === 'verified');
  expect('its secrets go by name, never by value', [exportedVerified.token.verify.secret, exportedVerified.token.verify.secretId, exported.secrets.find((secret) => secret.name === `hs-${suffix}-renamed`), r.raw.includes('new secret'), r.raw.includes(Buffer.from('new secret').toString('base64'))], [`hs-${suffix}-renamed`, undefined, { name: `hs-${suffix}-renamed`, algorithm: 'HS256' }, false, false]);

  const toTwo = (method, url, body, headers) => call(two.app, method, `/api${url}`, body, headers);
  r = await toTwo('POST', '/projects/import', { konggate: 1, project: {} });
  expect('a file without a project is refused', r.status, 400);
  r = await toTwo('POST', '/projects/import', { hello: 'world' });
  expect('so is a file that is something else', r.status, 400);
  r = await toTwo('GET', '/projects');
  expect('and nothing of a refused file is kept', r.json, []);

  r = await toTwo('POST', '/projects/import', exported);
  expect('the other computer imports it whole', [r.status, r.json.project.name, r.json.works, r.json.clashes], [201, `test-${suffix}`, exported.works.length, []]);
  expect('and is told which secrets it has to be given', r.json.missingSecrets.map((secret) => secret.name).sort(), exported.secrets.map((secret) => secret.name).sort());
  r = await call(two.gateway, 'GET', '/plain/now-here');
  expect('its gateway serves the imported works at once', [r.status, r.json.url], [200, '/now-here']);
  r = await toTwo('GET', '/secrets');
  const pending = r.json.find((secret) => secret.name === `hs-${suffix}-renamed`);
  expect('the secrets came as names waiting for a value', [pending.algorithm, pending.hasValue], ['HS256', false]);
  r = await call(two.gateway, 'GET', '/verified', undefined, { Authorization: `Bearer ${hsToken(good, 'new secret')}` });
  expect('until one has its value, the works verifying against it let nothing through', r.status, 401);

  await toTwo('POST', '/admin/password', { password });
  const sessionTwo = { Authorization: `Bearer ${(await toTwo('POST', '/login', { password })).json.token}` };
  r = await toTwo('PATCH', `/secrets/${pending.id}`, { name: pending.name, algorithm: 'HS256', value: 'new secret' }, sessionTwo);
  expect('an administrator there enters the value', [r.status, r.json.hasValue], [200, true]);
  r = await call(two.gateway, 'GET', '/verified', undefined, { Authorization: `Bearer ${hsToken(good, 'new secret')}` });
  expect('and the work verifies tokens again', r.status, 200);

  r = await toTwo('POST', '/projects/import', exported);
  expect('imported again, it comes under another name', [r.status, r.json.project.name, r.json.missingSecrets], [201, `test-${suffix} (2)`, []]);
  expect('with word of every path that is now answered twice', [r.json.clashes.length, r.json.clashes.find((item) => item.work === 'plain')], [exported.works.length, { work: 'plain', path: '/plain', with: `test-${suffix} / plain` }]);

  console.log('\n# kept in a file');
  const onDisk = readFileSync(one.dataFile, 'utf8');
  expect('the data file holds the projects and works', [JSON.parse(onDisk).projects.length, JSON.parse(onDisk).works.length], [1, exported.works.length]);
  expect('with the secrets\' values sealed', [onDisk.includes('new secret'), onDisk.includes(Buffer.from('new secret').toString('base64')), JSON.parse(onDisk).secrets[0].value.startsWith('test:')], [false, false, true]);
  await one.engine.stop();
  // Back as a built app would start it: with its version and the day it was built.
  one = await engineOn('one', 18100, 18101, { version: '9.9.9', buildDate: '2026-10-31' });
  // The connections this test kept open to the stopped engine are dead; the
  // first call finds that out and the next ones are made afresh.
  await fetch(`${one.app}/api/status`).catch(() => undefined);
  await fetch(`${one.gateway}/`).catch(() => undefined);
  r = await api('GET', '/projects');
  expect('after a restart the projects are still there', r.json.map((project) => project.name), [`test-${suffix}`]);
  r = await api('GET', '/status');
  expect('a built app says its version and the day it was built', [r.json.version, r.json.buildDate], ['9.9.9', '2026-10-31']);
  r = await through('GET', '/verified', { headers: { Authorization: `Bearer ${hsToken(good, 'new secret')}` } });
  expect('and so are the secrets, unsealed for the gateway', r.status, 200);
  r = await api('POST', '/secrets', { name: 'x', algorithm: 'HS256', value: 'v' }, session);
  expect('but not the sign-in sessions', r.status, 401);

  console.log('\n# settings changed while running');
  r = await api('PUT', '/settings', { gateway: { port: 18150, public: false } });
  expect('the gateway moves to another port', [r.status, r.json.gateway.port, r.json.gateway.running], [200, 18150, true]);
  r = await call('http://127.0.0.1:18150', 'GET', '/plain/moved');
  expect('and answers there', r.status, 200);
  r = await api('PUT', '/settings', { gateway: { port: 18200 } });
  expect('a port another program holds is reported', [r.json.gateway.running, r.json.gateway.error.reason], [false, 'port_in_use']);
  r = await api('PUT', '/settings', { gateway: { port: 18150 } });
  expect('and a free one brings the gateway back', r.json.gateway.running, true);

  console.log('\n# the command line');
  const folderOne = path.dirname(one.dataFile);
  // Not waited for in a way that would stop this process: the engine the
  // command line talks to runs in it.
  const cliIn = (folder, args, env = {}) =>
    new Promise((resolve) => {
      execFile(process.execPath, [CLI, '--data', folder, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }, (error, out, err) =>
        resolve({ code: error ? (error.code ?? 1) : 0, out, err }),
      );
    });
  const cli = (args, env) => cliIn(folderOne, args, env);
  let c = await cli(['help']);
  expect('help lists the commands', [c.code, c.out.includes('konggate <command>'), c.out.includes('secrets add <name>')], [0, true, true]);
  const { version } = JSON.parse(readFileSync(path.join(path.dirname(CLI), 'package.json'), 'utf8'));
  expect('and starts with the version, with no build day in a checkout', c.out.split('\n')[0], `KongGate ${version}`);
  // The command line as the build packs it: its package.json says when it was built.
  const packed = path.join(scratch, 'packed');
  mkdirSync(packed);
  copyFileSync(CLI, path.join(packed, 'cli.mjs'));
  writeFileSync(path.join(packed, 'package.json'), JSON.stringify({ version, buildDate: '2026-10-31' }));
  c = await new Promise((resolve) => {
    execFile(process.execPath, [path.join(packed, 'cli.mjs'), 'help'], { encoding: 'utf8' }, (error, out) => resolve({ code: error ? 1 : 0, out }));
  });
  expect('a built one names the day too', [c.code, c.out.split('\n')[0]], [0, `KongGate ${version} (2026-10-31)`]);
  c = await cliIn(path.join(scratch, 'nobody'), ['status']);
  expect('with no KongGate running there, it says so', [c.code, c.err.includes('KongGate is not running')], [1, true]);
  c = await cli(['status']);
  expect('status: the gateway and where the secrets are', [c.code, c.out.includes('http://localhost:18150'), c.out.includes('this computer\'s file')], [0, true, true]);
  expect('and which release is running, built on which day', c.out.split('\n')[0], 'KongGate 9.9.9 (2026-10-31)');
  c = await cli(['projects']);
  expect('projects are listed', [c.code, c.out.includes(`test-${suffix}`)], [0, true]);
  c = await cli(['works', `test-${suffix}`]);
  expect('and a project\'s works, with what verifies their tokens', [c.code, c.out.includes('/verified'), c.out.includes(`verified: hs-${suffix}-renamed`)], [0, true, true]);

  const exportedTo = path.join(scratch, 'from-cli.json');
  c = await cli(['export', `test-${suffix}`, exportedTo]);
  const written = JSON.parse(readFileSync(exportedTo, 'utf8'));
  expect('export writes the project to a file', [c.code, written.project.name, written.works.length, readFileSync(exportedTo, 'utf8').includes('new secret')], [0, `test-${suffix}`, exported.works.length, false]);
  c = await cli(['import', exportedTo]);
  expect('import adds it back under another name, and says what clashes', [c.code, c.out.includes(`"test-${suffix} (2)"`), c.out.includes('answered by two works')], [0, true, true]);
  r = await api('GET', '/projects');
  expect('and the app has it', r.json.map((project) => project.name), [`test-${suffix}`, `test-${suffix} (2)`]);

  c = await cli(['port', '18160', '--local']);
  r = await call('http://127.0.0.1:18160', 'GET', '/plain/by-cli');
  expect('port moves the gateway', [c.code, c.out.includes('port 18160'), r.status], [0, true, 200]);
  c = await cli(['port', '18200']);
  expect('a port that is taken is refused, with the reason', [c.code, c.err.includes('could not start on port 18200')], [1, true]);
  c = await cli(['port', '18150']);
  expect('and the next one is taken up', [c.code, (await cli(['port'])).out.trim()], [0, '18150, this computer only']);

  const scripted = { KONGGATE_ADMIN_PASSWORD: password, KONGGATE_SECRET_VALUE: 'value from the command line' };
  c = await cli(['secrets', 'add', 'cli-secret', '--algorithm', 'HS384'], scripted);
  expect('an administrator adds a secret', [c.code, c.out.trim()], [0, 'cli-secret (HS384): added.']);
  c = await cli(['secrets']);
  expect('which is listed without its value', [c.out.includes('cli-secret'), c.out.includes('HS384'), c.out.includes('value from the command line')], [true, true, false]);
  c = await cli(['secrets', 'add', 'cli-secret'], scripted);
  expect('a secret that has a value is not given another by accident', [c.code, c.err.includes('--replace')], [1, true]);
  c = await cli(['secrets', 'remove', 'cli-secret'], { KONGGATE_ADMIN_PASSWORD: 'not the password' });
  expect('the wrong administrator password gets nowhere', [c.code, c.err.trim()], [1, 'konggate: wrong password']);
  c = await cli(['secrets', 'remove', 'cli-secret'], scripted);
  expect('the right one removes the secret', [c.code, (await cli(['secrets'])).out.includes('cli-secret')], [0, false]);
  c = await cli(['log', '--failed', '--limit', '3']);
  expect('the log is at hand too', c.code, 0);

  r = await api('PUT', '/settings', { window: { onClose: 'quit' } });
  expect('what closing the window means is a setting, kept on disk', [(await api('GET', '/settings')).json.window, JSON.parse(readFileSync(path.join(folderOne, 'settings.json'), 'utf8')).window], [{ onClose: 'quit' }, { onClose: 'quit' }]);
  r = await api('PUT', '/settings', { window: { onClose: 'nonsense' } });
  expect('and only takes what it knows', (await api('GET', '/settings')).json.window, { onClose: 'ask' });
  r = await api('POST', '/quit');
  expect('an engine nobody told how to end its program cannot be stopped from outside', r.status, 501);

  if (!process.env.KONGGATE_TEST_DB) {
    console.log('\n# secrets in a shared database: skipped (give KONGGATE_TEST_DB a database nobody uses)');
  } else {
    console.log('\n# secrets in a shared database');
    const target = new URL(process.env.KONGGATE_TEST_DB);
    const shared = {
      host: target.hostname,
      port: Number(target.port || 5432),
      database: target.pathname.slice(1),
      user: decodeURIComponent(target.username),
      password: decodeURIComponent(target.password),
      ssl: false,
    };
    // Whatever an earlier run left: this database is the test's to empty.
    const { default: pg } = await import('pg');
    const direct = new pg.Client(shared);
    await direct.connect();
    await direct.query('DROP TABLE IF EXISTS kg_secrets, kg_settings');

    const through18150 = (url, headers) => call('http://127.0.0.1:18150', 'GET', url, undefined, headers);
    const signed = (secret) => ({ Authorization: `Bearer ${hsToken(good, secret)}` });

    r = await api('POST', '/settings/test', { database: { ...shared, password: 'wrong' } });
    expect('a wrong database password is explained', [r.json.ok, r.json.error.reason], [false, 'credentials']);
    r = await api('POST', '/settings/test', { database: { ...shared, port: 1 } });
    expect('so is a closed port', [r.json.ok, r.json.error.reason], [false, 'refused']);
    r = await api('PUT', '/settings', { database: shared });
    expect('connecting is reported', [r.json.database.used, r.json.database.connected, r.json.database.host], [true, true, shared.host]);
    r = await api('GET', '/settings');
    expect('the settings never show the database password', [r.json.database.password, r.json.database.hasPassword, r.raw.includes(shared.password)], [undefined, true, false]);
    expect('on disk it is sealed', readFileSync(path.join(folderOne, 'settings.json'), 'utf8').includes(shared.password), false);

    r = await api('GET', '/secrets');
    expect('the secrets are now the database\'s: none yet', r.json, []);
    r = await through18150('/verified', signed('new secret'));
    expect('a work verifying against a secret of the file lets nothing through meanwhile', r.status, 401);
    r = await api('GET', '/admin');
    expect('the database has an administrator of its own: none yet', r.json.passwordSet, false);

    const sharedPassword = `shared-${suffix}-pw`;
    await api('POST', '/admin/password', { password: sharedPassword });
    const sharedSession = { Authorization: `Bearer ${(await api('POST', '/login', { password: sharedPassword })).json.token}` };
    r = await api('POST', '/secrets', { name: 'shared-hs', algorithm: 'HS256', value: 'shared secret' }, sharedSession);
    expect('the administrator adds a secret to it', [r.status, r.json.hasValue], [201, true]);
    const sharedSecret = r.json;

    r = await toTwo('PUT', '/settings', { database: shared });
    expect('another computer connects to the same database', r.json.database.connected, true);
    r = await toTwo('GET', '/secrets');
    expect('and sees the secret, by name', r.json.map((secret) => [secret.id, secret.name, secret.hasValue]), [[sharedSecret.id, 'shared-hs', true]]);
    r = await toTwo('POST', '/login', { password });
    expect('its own old administrator password no longer counts', r.status, 401);
    r = await toTwo('POST', '/login', { password: sharedPassword });
    expect('the database\'s one does, there too', r.status, 200);
    const sharedSessionTwo = { Authorization: `Bearer ${r.json.token}` };

    const projectTwo = (await toTwo('POST', '/projects', { name: `shared-${suffix}` })).json;
    r = await toTwo('POST', '/works', { projectId: projectTwo.id, ...work({ name: 'by-shared', path: '/by-shared', token: { enabled: true, verify: { enabled: true, secretId: sharedSecret.id } } }) });
    expect('a work there picks the shared secret', r.status, 201);
    r = await call(two.gateway, 'GET', '/by-shared', undefined, signed('shared secret'));
    const wrong = await call(two.gateway, 'GET', '/by-shared', undefined, signed('something else'));
    expect('and its gateway verifies tokens with a secret nobody there entered', [r.status, wrong.status], [200, 401]);

    r = await api('PATCH', `/secrets/${sharedSecret.id}`, { name: 'shared-hs', algorithm: 'HS256', value: 'rotated secret' }, sharedSession);
    let rotated = 401;
    for (let i = 0; i < 40 && rotated !== 200; i += 1) {
      await sleep(250);
      rotated = (await call(two.gateway, 'GET', '/by-shared', undefined, signed('rotated secret'))).status;
    }
    expect('a value replaced on one computer reaches the other by itself', rotated, 200);

    r = await toTwo('GET', `/projects/${projectTwo.id}/export`);
    expect('an export names the shared secret, and holds no value', [r.json.works[0].token.verify.secret, r.json.secrets, r.raw.includes('rotated secret')], ['shared-hs', [{ name: 'shared-hs', algorithm: 'HS256' }], false]);
    r = await toTwo('POST', '/projects/import', { ...r.json, project: { name: `again-${suffix}` }, works: [{ ...r.json.works[0], path: '/again', token: { enabled: true, verify: { enabled: true, secret: 'not-there-yet' } } }], secrets: [{ name: 'not-there-yet', algorithm: 'RS256' }] });
    expect('an import naming a secret the database lacks leaves a place for it there', [r.status, r.json.missingSecrets], [201, [{ name: 'not-there-yet', algorithm: 'RS256' }]]);
    r = await api('GET', '/secrets');
    expect('which every computer sees waiting for its value', r.json.map((secret) => [secret.name, secret.hasValue]), [['not-there-yet', false], ['shared-hs', true]]);
    r = await toTwo('DELETE', `/secrets/${sharedSecret.id}`, undefined, sharedSessionTwo);
    expect('a secret this computer\'s works use is not deleted from here', [r.status, r.json.in_use], [409, 1]);

    c = await cli(['database']);
    expect('the command line says where the secrets come from', [c.code, c.out.includes(`${shared.user}@${shared.host}:${shared.port}/${shared.database}: connected`)], [0, true]);
    c = await cli(['database', 'set', '--host', shared.host, '--port', String(shared.port), '--name', shared.database, '--user', shared.user], { KONGGATE_DB_PASSWORD: 'wrong' });
    expect('and does not save a connection that does not work', [c.code, c.err.includes('not saved')], [1, true]);

    await direct.query('ALTER TABLE kg_secrets RENAME TO kg_secrets_away');
    await sleep(100);
    r = await api('GET', '/secrets');
    expect('a database that stops answering is a failure the screens can show', r.status >= 500, true);
    r = await api('GET', '/projects');
    expect('while the projects, which are not in it, are still there', r.status, 200);
    r = await call(two.gateway, 'GET', '/by-shared', undefined, signed('rotated secret'));
    expect('and the gateways go on with the secrets they last read', r.status, 200);
    await direct.query('ALTER TABLE kg_secrets_away RENAME TO kg_secrets');

    c = await cli(['database', 'off']);
    r = await api('GET', '/secrets');
    expect('switched off, the secrets of this computer\'s file are back', [c.code, r.json.some((secret) => secret.name === `hs-${suffix}-renamed`), r.json.some((secret) => secret.name === 'shared-hs')], [0, true, false]);
    r = await through18150('/verified', signed('new secret'));
    expect('and its works verify with them again', r.status, 200);

    await toTwo('PUT', '/settings', { database: null });
    await direct.query('DROP TABLE IF EXISTS kg_secrets, kg_settings');
    await direct.end();
  }
} catch (error) {
  failed += 1;
  console.error('\nThe test itself broke:', error);
} finally {
  await one.engine.stop();
  await two.engine.stop();
  upstream.close();
  upstream.closeAllConnections();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
