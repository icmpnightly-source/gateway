// Exercises the whole engine against a real PostgreSQL, through the same two
// doors everything else uses: the app's API and the gateway's port.
//
//   node test/engine.test.mjs
//
// Needs a database nobody uses: it creates and removes its own rows, and it
// replaces the administrator's password.
//   KONGGATE_TEST_DB=postgres://user:password@host:port/database

import { createHmac, generateKeyPairSync, sign as signWith, constants } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { startEngine } from '../engine/index.mjs';

const dbUrl = new URL(process.env.KONGGATE_TEST_DB ?? 'postgres://konggate:test-only-pw@127.0.0.1:55432/konggate');
const DATABASE = {
  host: dbUrl.hostname,
  port: Number(dbUrl.port || 5432),
  database: dbUrl.pathname.slice(1),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  ssl: false,
};

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

// --- two engines on one database: two computers --------------------------------

const scratch = mkdtempSync(path.join(os.tmpdir(), 'konggate-test-'));

async function engineOn(name, gatewayPort, appPort) {
  const settingsFile = path.join(scratch, `${name}.json`);
  writeFileSync(
    settingsFile,
    JSON.stringify({
      database: { ...DATABASE, password: `plain:${Buffer.from(DATABASE.password).toString('base64')}` },
      gateway: { port: gatewayPort, public: false },
      app: { port: appPort },
    }),
  );
  const engine = await startEngine({ settingsFile, uiDir: path.join(scratch, 'no-ui'), report: () => undefined });
  return { engine, app: engine.url, gateway: `http://127.0.0.1:${gatewayPort}`, settingsFile };
}

// A run sets the administrator's password, and the next run has to be able to
// set its own: the one this database holds is forgotten first. (Which is why
// the database has to be one nobody uses.)
if (!process.env.KONGGATE_TEST_ADMIN) {
  const client = new pg.Client(DATABASE);
  await client.connect();
  await client.query(`DELETE FROM kg_settings WHERE key = 'admin_password'`).catch(() => undefined);
  await client.end();
}

const one = await engineOn('one', 18100, 18101);
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

const created = { projects: [], secrets: [] };
let session;

try {
  // Wait for both to have reached the database.
  for (let i = 0; i < 50 && !(one.engine.status().database.connected && two.engine.status().database.connected); i += 1) {
    await sleep(100);
  }

  console.log('# this computer');
  let r = await api('GET', '/status');
  expect('status: set up and connected', [r.status, r.json.configured, r.json.database.connected, r.json.gateway.running], [200, true, true, true]);
  r = await api('GET', '/settings');
  expect('settings never show the password', [r.json.database.password, r.json.database.hasPassword], [undefined, true]);
  r = await api('POST', '/settings/test', { database: { ...DATABASE, password: 'wrong' } });
  expect('a wrong database password is explained', [r.json.ok, r.json.error.reason], [false, 'credentials']);
  r = await api('POST', '/settings/test', { database: { ...DATABASE, password: undefined } });
  expect('testing with the saved password works', r.json.ok, true);
  r = await api('POST', '/settings/test', { database: { ...DATABASE, port: 1 } });
  expect('a closed database port is explained', [r.json.ok, r.json.error.reason], [false, 'refused']);

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
  created.projects.push(projectId);
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
  if (r.json.passwordSet) {
    console.log('      (the database already has an administrator password; using KONGGATE_TEST_ADMIN)');
  } else {
    r = await api('POST', '/admin/password', { password: 'short' });
    expect('a short first password is refused', r.status, 400);
    r = await api('POST', '/admin/password', { password });
    expect('the first password is set by whoever comes first', r.status, 204);
    r = await api('POST', '/admin/password', { password: 'another-password' });
    expect('after that it takes the current one', r.status, 401);
  }
  const adminPassword = process.env.KONGGATE_TEST_ADMIN ?? password;
  r = await api('POST', '/login', { password: 'wrong-password' });
  expect('a wrong password: 401', r.status, 401);
  r = await api('POST', '/login', { password: adminPassword });
  expect('the right one opens a session', [r.status, typeof r.json.token], [200, 'string']);
  session = { Authorization: `Bearer ${r.json.token}` };
  r = await call(two.app, 'POST', '/api/secrets', { name: 'x', algorithm: 'HS256', value: 'v' }, session);
  expect('a session opened on one computer is not one on another', r.status, 401);

  const addSecret = async (body) => {
    const response = await api('POST', '/secrets', body, session);
    if (response.status !== 201) throw new Error(`could not add a secret: ${response.raw}`);
    created.secrets.push(response.json.id);
    return response.json;
  };

  const hs = await addSecret({ name: `hs-${suffix}`, algorithm: 'HS256', value: 'the shared secret' });
  expect('a secret comes back without its value', Object.keys(hs).sort(), ['algorithm', 'createdAt', 'id', 'name']);
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

  console.log('\n# two computers, one database');
  r = await call(two.gateway, 'GET', '/plain/seen-by-two');
  expect('the other computer\'s gateway has the same works', [r.status, r.json?.url], [200, '/seen-by-two']);
  await addWork({ name: 'fresh', path: '/fresh' });
  let seen = 404;
  for (let i = 0; i < 40 && seen !== 200; i += 1) {
    await sleep(250);
    seen = (await call(two.gateway, 'GET', '/fresh')).status;
  }
  expect('a work added on one shows up on the other by itself', seen, 200);
  r = await call(two.gateway, 'GET', '/verified', undefined, { Authorization: `Bearer ${hsToken(good, 'new secret')}` });
  expect('and so do the secrets it verifies with', r.status, 200);

  console.log('\n# settings changed while running');
  r = await api('PUT', '/settings', { gateway: { port: 18150, public: false } });
  expect('the gateway moves to another port', [r.status, r.json.gateway.port, r.json.gateway.running], [200, 18150, true]);
  r = await call('http://127.0.0.1:18150', 'GET', '/plain/moved');
  expect('and answers there', r.status, 200);
  r = await api('PUT', '/settings', { database: { password: 'wrong' } });
  expect('a database that turns the app away is reported', [r.json.database.connected, r.json.database.error.reason], [false, 'credentials']);
  r = await api('GET', '/projects');
  expect('and the screens say why they have nothing to show', [r.status, r.json.reason], [503, 'credentials']);
  r = await call('http://127.0.0.1:18150', 'GET', '/plain/still');
  expect('while the gateway goes on with what it knew', r.status, 200);
  r = await api('PUT', '/settings', { database: { password: DATABASE.password } });
  expect('the right password brings it back', r.json.database.connected, true);
} catch (error) {
  failed += 1;
  console.error('\nThe test itself broke:', error);
} finally {
  // Leave the database as it was found: the works go with their projects.
  for (const id of created.projects) await api('DELETE', `/projects/${id}`).catch(() => undefined);
  for (const id of created.secrets) await api('DELETE', `/secrets/${id}`, undefined, session).catch(() => undefined);

  await one.engine.stop();
  await two.engine.stop();
  upstream.close();
  upstream.closeAllConnections();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
