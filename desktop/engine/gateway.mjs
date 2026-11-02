// The gateway itself: takes a client's request, finds the work it belongs to,
// passes it through the work's plugins in their order, and forwards it to the
// work's destination; the destination's answer goes back through them too.
//
// What each plugin does is in plugins/; here is what they share: the request
// as it will be sent, the headers every answer gets, and the answer itself.

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { brotliDecompressSync, constants as zlib, gunzipSync, inflateSync } from 'node:zlib';

/** Response header a recorded request's id comes back in. */
export const TRACE_ID_HEADER = 'X-Trace-Id';

// The most a destination is given just to accept the connection. An address
// that nothing answers on at all should fail fast, however patient the work
// is about the answer itself.
const CONNECT_SECONDS = 5;

// Headers that belong to one connection, not to the request travelling over it.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection', 'expect']);

// Whose values never go into the requests log.
const ALWAYS_MASKED = ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'apikey'];

// The longest a plugin is given for one step of one request.
const PLUGIN_SECONDS = 10;
// How often what plugins keep between requests (counters, a cache) is tidied.
const SWEEP_MS = 60000;

const HEADER = /^[A-Za-z0-9_-]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

// Enough to tell values apart without turning the log into a copy of the traffic.
const MAX_LOGGED_VALUE = 1024;
const MAX_LOGGED_BODY = 2048;
// How much of a body is held on to for the log: a compressed one has to be
// unpacked before its start can be read.
const MAX_HELD_BODY = 64 * 1024;
const TEXT_TYPES = ['json', 'xml', 'text/', 'x-www-form-urlencoded', 'graphql'];

// A header value as Node puts it on the wire: one byte per character. Ours
// are text, so they go out as UTF-8, which is also how they would arrive.
export const wire = (text) => Buffer.from(String(text), 'utf8').toString('latin1');
export const unwire = (value) => Buffer.from(String(value), 'latin1').toString('utf8');

// --- a request's headers, in order, names as they were written ---------------

function headersFrom(raw) {
  const list = [];
  for (let index = 0; index < raw.length; index += 2) list.push([raw[index], raw[index + 1]]);
  return list;
}

function getHeader(list, name) {
  const wanted = name.toLowerCase();
  const values = list.filter(([key]) => key.toLowerCase() === wanted).map(([, value]) => value);
  return values.length > 0 ? values.join(', ') : undefined;
}

function checkedHeader(name, value) {
  if (!HEADER.test(String(name))) throw new TypeError(`"${name}" is not a header name`);
  const text = String(value);
  if (CONTROL.test(text)) throw new TypeError(`the value of ${name} has to be on one line`);
  return wire(text);
}

function removeHeader(list, name) {
  const wanted = name.toLowerCase();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index][0].toLowerCase() === wanted) list.splice(index, 1);
  }
}

function setHeader(list, name, value) {
  removeHeader(list, name);
  list.push([name, value]);
}

// For http.request: one entry per name, a list where a header was sent several times.
function toNodeHeaders(list) {
  const headers = {};
  const written = new Map();

  for (const [name, value] of list) {
    const key = written.get(name.toLowerCase());
    if (key === undefined) {
      written.set(name.toLowerCase(), name);
      headers[name] = value;
    } else {
      headers[key] = [].concat(headers[key], value);
    }
  }
  return headers;
}

// --- the requests log --------------------------------------------------------

const shorten = (value, limit) => (value.length > limit ? `${value.slice(0, limit)}… (${value.length} bytes)` : value);

// Says that there was a value, and for Authorization what kind, but not what.
function masked(value) {
  const scheme = /^([A-Za-z]+)\s+\S/.exec(value);
  return scheme ? `${scheme[1]} ***` : '***';
}

function loggedHeaders(list, redact) {
  const headers = {};
  for (const [name, value] of list) {
    if (value === '') continue;
    const key = name.toLowerCase();
    const shown = redact.has(key) ? masked(value) : shorten(unwire(value), MAX_LOGGED_VALUE);
    headers[key] = key in headers ? `${headers[key]}, ${shown}` : shown;
  }
  return headers;
}

export const isText = (contentType) => {
  const type = (contentType ?? '').toLowerCase();
  return TEXT_TYPES.some((kind) => type.includes(kind));
};

// --- which work a request belongs to -----------------------------------------

export const pathMatches = (prefix, pathname) =>
  prefix === '/' || pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/** Works as the gateway uses them: the most specific path first. */
export function compileWorks(works) {
  return works
    .map((work) => {
      let base = null;
      try {
        base = new URL(work.destination);
        if (base.protocol !== 'http:' && base.protocol !== 'https:') base = null;
      } catch {
        // Left null: the work answers 502 until its destination is fixed.
      }
      return { ...work, base };
    })
    .sort((a, b) => b.path.length - a.path.length || Number(b.methods.length > 0) - Number(a.methods.length > 0));
}

function findWork(works, method, pathname, preflightFor) {
  for (const work of works) {
    if (!pathMatches(work.path, pathname)) continue;
    if (work.methods.length === 0 || work.methods.includes(method)) return work;
    // A browser asks permission with OPTIONS before the real request; the
    // work that would take that request is the one to answer for it.
    if (preflightFor && work.methods.includes(preflightFor)) return work;
  }
  return undefined;
}

// --- why a destination could not be reached ----------------------------------

export function describeFailure(error, target, connectSeconds, timeoutSeconds) {
  switch (error.code) {
    case 'KG_CONNECT_TIMEOUT':
      return { status: 504, reason: 'connect_timeout', message: `${target} did not accept the connection within ${connectSeconds} s` };
    case 'KG_RESPONSE_TIMEOUT':
      return { status: 504, reason: 'response_timeout', message: `${target} accepted the request but did not answer within ${timeoutSeconds} s` };
    case 'ETIMEDOUT':
      return { status: 504, reason: 'connect_timeout', message: `${target} did not accept the connection` };
    case 'ECONNREFUSED':
      return { status: 502, reason: 'refused', message: `${target} refused the connection: nothing is listening on that port` };
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EADDRNOTAVAIL':
      return { status: 502, reason: 'unreachable', message: `there is no route from this computer to ${target}` };
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { status: 503, reason: 'unknown_host', message: `the name in ${target} could not be found` };
    case 'ECONNRESET':
    case 'EPIPE':
      return { status: 502, reason: 'closed', message: `${target} closed the connection without answering` };
    default:
      if (/^HPE_/.test(error.code ?? '')) {
        return { status: 502, reason: 'not_http', message: `${target} answered with something that is not HTTP` };
      }
      if (/SSL|TLS|EPROTO/i.test(`${error.code} ${error.message}`)) {
        return { status: 502, reason: 'tls', message: `an encrypted (https) connection to ${target} could not be set up: ${error.message}` };
      }
      return { status: 502, reason: 'failed', message: `${target} could not be reached: ${error.message}` };
  }
}

export function timeoutError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * The path a request for `pathname` is sent on to: the destination's own
 * path, then what the client asked for, all of it or what follows the work's
 * path. `base` is the work's destination as a URL.
 */
export function upstreamPathOf(work, base, pathname, search) {
  const prefix = work.path === '/' ? '' : work.path;
  const tail = work.stripPath ? pathname.slice(prefix.length) : pathname;
  return (base.pathname.replace(/\/$/, '') + (tail === '' || tail.startsWith('/') ? tail : `/${tail}`) || '/') + search;
}

// --- the gateway --------------------------------------------------------------

/** A plugin that threw, or took too long: the request is answered 500. */
class PluginFailure extends Error {
  constructor(plugin, cause) {
    super(`plugin "${plugin}" failed: ${cause?.message ?? cause}`);
    this.plugin = plugin;
    this.cause = cause;
  }
}

function withinTime(promise, plugin) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`took longer than ${PLUGIN_SECONDS} s`)), PLUGIN_SECONDS * 1000);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * `getWorks` and `getSecret` give the current configuration, `getPlugin` a
 * plugin by name; `log` is where recorded requests go, `report` where a
 * plugin's mistakes are written down.
 */
export function createGateway({ getWorks, getSecret, getPlugin, log, report = console.error }) {
  // What a work's plugin keeps between requests, made by its `prepare`: kept
  // while the work keeps that plugin with the same settings.
  const states = new Map();
  let builtFor = null;
  let pipelines = new Map();

  function prepared(work, instance, definition) {
    const key = `${work.id}\n${instance.name}\n${JSON.stringify(instance.config)}`;
    const known = states.get(key);
    if (known && known.definition === definition) return { key, ...known };

    let made = { definition, state: undefined, error: undefined };
    try {
      if (definition.prepare) made.state = definition.prepare(instance.config, { work });
    } catch (error) {
      made = { definition, state: undefined, error };
    }
    states.set(key, made);
    return { key, ...made };
  }

  // Each work's plugins as they run: those switched on, those this computer
  // lacks, and what the requests log must not show.
  function pipelineOf(work) {
    const works = getWorks();
    if (works !== builtFor) {
      const used = new Set();
      pipelines = new Map();
      for (const each of works) {
        const steps = [];
        const missing = [];
        const masked = new Set(ALWAYS_MASKED);
        const maskedQuery = new Set();
        for (const instance of each.plugins ?? []) {
          if (!instance.enabled) continue;
          const definition = getPlugin(instance.name);
          if (!definition) {
            missing.push(instance.name);
            continue;
          }
          const { key, state, error } = prepared(each, instance, definition);
          used.add(key);
          steps.push({ name: instance.name, definition, config: instance.config, state, error });
          for (const name of definition.secretHeaders?.(instance.config) ?? []) masked.add(name.toLowerCase());
          for (const name of definition.secretQuery?.(instance.config) ?? []) maskedQuery.add(name);
        }
        pipelines.set(each.id, { steps, missing, masked, maskedQuery });
      }
      for (const key of states.keys()) if (!used.has(key)) states.delete(key);
      builtFor = works;
    }
    return pipelines.get(work.id) ?? { steps: [], missing: [], masked: new Set(ALWAYS_MASKED), maskedQuery: new Set() };
  }

  const sweep = setInterval(() => {
    for (const { state } of states.values()) {
      try {
        state?.sweep?.();
      } catch (error) {
        report(error);
      }
    }
  }, SWEEP_MS);
  sweep.unref();

  const env = { secret: (id) => getSecret(id), report };

  async function handle(req, res) {
    const startedAt = Date.now();
    const queryAt = req.url.indexOf('?');
    const pathname = queryAt === -1 ? req.url : req.url.slice(0, queryAt);
    const search = queryAt === -1 ? '' : req.url.slice(queryAt);
    const clientIp = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const scheme = req.socket.encrypted ? 'https' : 'http';

    const incoming = headersFrom(req.rawHeaders);
    const origin = getHeader(incoming, 'origin');
    const preflightFor =
      req.method === 'OPTIONS' && origin ? getHeader(incoming, 'access-control-request-method') : undefined;

    const work = findWork(getWorks(), req.method, pathname, preflightFor);

    // Headers every answer on this work carries, the gateway's own included.
    const extra = [];
    // What the requests log will say, when this request is recorded.
    let record = null;

    // The request body goes to the log, if it is recorded, from the moment it
    // starts to flow: to the destination, or away when nothing is sent.
    let bodyReleased = false;
    function releaseBody() {
      if (bodyReleased) return;
      bodyReleased = true;
      if (record && work.tracing.body) {
        captureBody(req, (name) => getHeader(incoming, name), (body) => {
          record.in.body = record.scrub(body);
        });
      }
    }

    function answer(status, body, headers = []) {
      let payload;
      let type;
      if (body === null || body === undefined) {
        payload = Buffer.alloc(0);
      } else if (Buffer.isBuffer(body)) {
        payload = body;
      } else if (typeof body === 'string') {
        payload = Buffer.from(body, 'utf8');
        type = 'text/plain; charset=utf-8';
      } else {
        payload = Buffer.from(JSON.stringify(body), 'utf8');
        type = 'application/json; charset=utf-8';
      }

      // Ours win over what was given where both name the same header.
      const ours = new Set(extra.map(([name]) => name.toLowerCase()));
      const given = headers.filter(([name]) => {
        const key = name.toLowerCase();
        return !ours.has(key) && key !== 'content-length' && !HOP_BY_HOP.has(key);
      });
      const hasType = given.some(([name]) => name.toLowerCase() === 'content-type');
      const sent = [
        ...(type && !hasType ? ['Content-Type', type] : []),
        'Content-Length', String(payload.length),
        ...given.flat(),
        ...extra.flat(),
      ];
      if (record) {
        const kind = type ?? getHeader(given, 'content-type');
        record.answer = {
          by: 'gateway',
          headers: loggedHeaders(headersFrom(sent), record.redact),
          ...(payload.length > 0 && isText(kind)
            ? { body: record.scrub(shorten(bodyText(payload, getHeader(given, 'content-encoding')) ?? '', MAX_LOGGED_BODY)) }
            : {}),
        };
      }

      res.writeHead(status, sent);
      res.end(req.method === 'HEAD' ? undefined : payload);
    }

    const refuse = (status, body, headers, note) => {
      if (record) record.out.note = note ?? `nothing sent: the gateway answered ${status} itself`;
      releaseBody();
      req.resume();
      answer(status, body, headers);
    };

    if (!work) {
      // Read to the end, so the connection can be used again.
      req.resume();
      answer(404, { message: 'no work answers this path and method', reason: 'no_work' });
      return;
    }

    const pipeline = pipelineOf(work);

    const recorded = work.tracing.enabled && Math.random() * 100 < work.tracing.samplingPercent;
    if (recorded) {
      const redact = pipeline.masked;
      let shownUrl = req.url;
      if (pipeline.maskedQuery.size > 0 && search) {
        const query = new URLSearchParams(search);
        for (const name of pipeline.maskedQuery) if (query.has(name)) query.set(name, '***');
        shownUrl = `${pathname}?${query.toString()}`;
      }
      record = {
        id: randomBytes(16).toString('hex'),
        time: new Date(startedAt).toISOString(),
        workId: work.id,
        workName: work.name,
        projectId: work.projectId,
        redact,
        in: {
          method: req.method,
          url: `${scheme}://${getHeader(incoming, 'host') ?? ''}${shownUrl}`,
          clientIp,
          headers: loggedHeaders(incoming, redact),
        },
        out: { sent: false },
      };
      extra.push([TRACE_ID_HEADER, record.id]);

      // The values masked in the headers (what follows "Bearer", where there
      // is one): a body that repeats one, as a service echoing its request
      // does, has it masked too.
      const hidden = incoming
        .filter(([name]) => redact.has(name.toLowerCase()))
        .map(([, value]) => value.replace(/^[A-Za-z]+\s+/, ''))
        .filter((value) => value.length >= 8)
        .sort((a, b) => b.length - a.length);
      record.scrub = (text) => hidden.reduce((result, value) => result.split(value).join('***'), text);

      res.once('close', () => {
        const { redact: _redact, scrub: _scrub, ...entry } = record;
        log.add({
          ...entry,
          // Nothing was sent if the client went away first.
          status: res.headersSent ? res.statusCode : null,
          durationMs: Date.now() - startedAt,
        });
      });
    }

    // A plugin switched on in the work but not on this computer: nothing
    // goes through, rather than a sign-in plugin silently left out.
    if (pipeline.missing.length > 0) {
      const [name] = pipeline.missing;
      refuse(500, { message: `plugin "${name}" is not installed on this computer`, reason: 'plugin_missing', plugin: name });
      return;
    }

    // --- what the plugins are given ---------------------------------------------

    // What the destination will be sent; starts as what the client sent.
    const outgoing = headersFrom(req.rawHeaders);
    const query = new URLSearchParams(search);
    let bodyLimit = null;
    let ended = null;
    let phase = 'rewrite';
    // In the response step: the destination's answer as it will go back.
    let answerHeaders = null;
    let destinationHeaders = null;
    let answerStatus;
    const bodyWatchers = [];

    const onlyInResponse = (what) => {
      if (phase !== 'response') throw new Error(`ctx.response.${what} is only there in the response step`);
    };

    const ctx = {
      work: { id: work.id, name: work.name, path: work.path, methods: [...work.methods], projectId: work.projectId },
      client: { ip: clientIp },
      request: {
        method: req.method,
        path: pathname,
        query,
        preflightFor,
        header: (name) => {
          const value = getHeader(outgoing, name);
          return value === undefined ? undefined : unwire(value);
        },
        incomingHeader: (name) => {
          const value = getHeader(incoming, name);
          return value === undefined ? undefined : unwire(value);
        },
        headers: () => outgoing.map(([name, value]) => [name, unwire(value)]),
        setHeader: (name, value) => setHeader(outgoing, name, checkedHeader(name, value)),
        addHeader: (name, value) => void outgoing.push([name, checkedHeader(name, value)]),
        removeHeader: (name) => removeHeader(outgoing, name),
        // The most a body may hold, counted as it goes through.
        limitBody: (maxBytes, message) => {
          bodyLimit = { maxBytes, message: message ?? 'the request body is too large' };
        },
      },
      response: {
        get status() {
          return answerStatus;
        },
        header: (name) => {
          const value = getHeader(phase === 'response' ? answerHeaders : extra, name);
          return value === undefined ? undefined : unwire(value);
        },
        setHeader: (name, value) => setHeader(phase === 'response' ? answerHeaders : extra, name, checkedHeader(name, value)),
        removeHeader: (name) => removeHeader(phase === 'response' ? answerHeaders : extra, name),
        destinationHeaders: () => {
          onlyInResponse('destinationHeaders()');
          return destinationHeaders.map(([name, value]) => [name, value]);
        },
        // The destination's whole body, once it has gone through; null when
        // it was larger than `maxBytes` or broke off.
        onBody: (callback, { maxBytes = 1024 * 1024 } = {}) => {
          onlyInResponse('onBody()');
          bodyWatchers.push({ callback, maxBytes });
        },
      },
      consumer: null,
      setConsumer(id) {
        ctx.consumer = id === null || id === undefined ? null : String(id);
      },
      shared: {},
      respond(status, body, headers = []) {
        if (phase === 'response') throw new Error('ctx.respond() is for the rewrite and access steps');
        if (!Number.isInteger(status) || status < 100 || status > 599) throw new TypeError(`${status} is not an answer code`);
        ended = { status, body, headers: headers.map(([name, value]) => [name, checkedHeader(name, value)]) };
      },
      answerPreflight(headers) {
        ended = { status: 200, body: null, headers, note: "nothing sent: the gateway answered the browser's preflight itself" };
      },
      log: (message) => report(`plugin on work "${work.name}": ${message}`),
    };

    async function run(step, stepPhase) {
      const call = step.definition[stepPhase];
      if (!call) return;
      if (step.error) throw new PluginFailure(step.name, step.error);
      phase = stepPhase === 'preflight' ? 'access' : stepPhase;
      try {
        const result = call.call(step.definition, ctx, step.config, step.state, env);
        if (result && typeof result.then === 'function') await withinTime(result, step.name);
      } catch (error) {
        throw new PluginFailure(step.name, error);
      }
    }

    function failed(error) {
      report(error.cause ?? error);
      const body = { message: error.message, reason: 'plugin', plugin: error.plugin };
      if (res.headersSent) return void res.destroy();
      refuse(500, body);
    }

    // A browser's preflight carries no token: the plugins are not asked about
    // it. With CORS on the work, the gateway answers it; without, it goes to
    // the destination as it came, through the plugins that ask to see it.
    const corsStep = preflightFor ? pipeline.steps.find((step) => step.definition.preflight) : undefined;
    const steps = preflightFor && !corsStep ? pipeline.steps.filter((step) => step.definition.onPreflight) : pipeline.steps;

    try {
      if (corsStep) {
        await run(corsStep, 'rewrite');
        await run(corsStep, 'preflight');
      } else {
        for (const step of steps) {
          await run(step, 'rewrite');
          if (ended) break;
        }
        if (!ended) {
          for (const step of steps) {
            await run(step, 'access');
            if (ended) break;
          }
        }
      }
    } catch (error) {
      if (error instanceof PluginFailure) return void failed(error);
      throw error;
    }

    // The client went away while the plugins were at it.
    if (res.destroyed) return;

    if (ended) {
      refuse(ended.status, ended.body, ended.headers, ended.note);
      return;
    }

    // --- forwarding -----------------------------------------------------------

    const { base } = work;
    if (!base) {
      refuse(502, { message: "the work's destination is not a usable address", reason: 'bad_destination' });
      return;
    }

    const prefix = work.path === '/' ? '' : work.path;
    // The query as the client wrote it, unless a plugin changed it.
    const changedQuery = query.toString();
    const sentSearch = changedQuery === new URLSearchParams(search).toString() ? search : changedQuery ? `?${changedQuery}` : '';
    const upstreamPath = upstreamPathOf(work, base, pathname, sentSearch);

    const forwardedFor = getHeader(incoming, 'x-forwarded-for');
    const host = getHeader(incoming, 'host') ?? '';
    for (const [name] of [...outgoing]) {
      if (HOP_BY_HOP.has(name.toLowerCase())) removeHeader(outgoing, name);
    }
    setHeader(outgoing, 'Host', base.host);
    setHeader(outgoing, 'X-Forwarded-For', forwardedFor ? `${forwardedFor}, ${clientIp}` : clientIp);
    setHeader(outgoing, 'X-Forwarded-Proto', scheme);
    setHeader(outgoing, 'X-Forwarded-Host', host.replace(/:\d+$/, ''));
    setHeader(outgoing, 'X-Forwarded-Port', String(req.socket.localPort ?? ''));
    setHeader(outgoing, 'X-Forwarded-Path', pathname);
    if (work.stripPath && prefix) setHeader(outgoing, 'X-Forwarded-Prefix', prefix);
    setHeader(outgoing, 'X-Real-IP', clientIp);

    const target = base.host;
    const secure = base.protocol === 'https:';
    const connectSeconds = Math.min(work.timeoutSeconds, CONNECT_SECONDS);

    if (record) {
      record.out = {
        sent: true,
        method: req.method,
        url: `${base.protocol}//${target}${upstreamPath}`,
        headers: loggedHeaders(outgoing, record.redact),
      };
    }

    const upstream = (secure ? https : http).request({
      protocol: base.protocol,
      hostname: base.hostname.replace(/^\[|\]$/g, ''),
      port: base.port || (secure ? 443 : 80),
      method: req.method,
      path: upstreamPath,
      headers: toNodeHeaders(outgoing),
      // A connection of its own for every request: a failure then always
      // means what it says, never a connection that went stale in between.
      agent: false,
      // Inside a company network the certificate is usually the server's own.
      rejectUnauthorized: false,
    });

    let connectTimer;
    upstream.once('socket', (socket) => {
      if (!socket.connecting) return;

      connectTimer = setTimeout(() => upstream.destroy(timeoutError('KG_CONNECT_TIMEOUT')), connectSeconds * 1000);
      socket.once(secure ? 'secureConnect' : 'connect', () => {
        clearTimeout(connectTimer);
        if (record) record.out.ip = socket.remoteAddress;
      });
    });
    // Silence on the connection for this long, before the answer or in the middle of it.
    upstream.setTimeout(work.timeoutSeconds * 1000, () => upstream.destroy(timeoutError('KG_RESPONSE_TIMEOUT')));

    upstream.once('response', async (answered) => {
      if (record) {
        record.out.status = answered.statusCode;
        record.out.response = {
          status: answered.statusCode,
          headers: loggedHeaders(headersFrom(answered.rawHeaders), record.redact),
        };
      }

      destinationHeaders = headersFrom(answered.rawHeaders).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase()));
      // Ours win over the destination's where both set the same header.
      const ours = new Set(extra.map(([name]) => name.toLowerCase()));
      answerHeaders = [
        ...destinationHeaders.filter(([name]) => !ours.has(name.toLowerCase())),
        ['Via', '1.1 konggate'],
        ...extra,
      ];
      answerStatus = answered.statusCode;

      try {
        for (const step of steps) await run(step, 'response');
      } catch (error) {
        answered.destroy();
        if (error instanceof PluginFailure) return void failed(error);
        report(error);
        return void res.destroy();
      }
      if (res.destroyed) return void answered.destroy();

      if (record) {
        if (work.tracing.body) {
          captureBody(answered, (name) => answered.headers[name], (body) => {
            record.out.response.body = record.scrub(body);
          });
        }
        record.answer = { by: 'destination', headers: loggedHeaders(answerHeaders, record.redact) };
      }

      for (const watcher of bodyWatchers) watchBody(answered, watcher, report);

      res.writeHead(answered.statusCode, answered.statusMessage, answerHeaders.flat());
      answered.pipe(res);
      // An answer that breaks off must not leave the client waiting for the rest.
      answered.once('close', () => {
        if (!answered.complete) res.destroy();
      });
    });

    upstream.on('error', (error) => {
      clearTimeout(connectTimer);

      // Half an answer already went out: all that is left is to cut it short.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // The client itself went away; there is nobody to tell.
      if (res.destroyed) return;

      if (error.code === 'KG_TOO_LARGE') {
        if (record) record.out.failed = { reason: 'too_large', message: bodyLimit.message };
        req.unpipe(upstream);
        req.resume();
        answer(413, { message: bodyLimit.message, reason: 'too_large' }, [['Connection', 'close']]);
        return;
      }

      const failure = describeFailure(error, target, connectSeconds, work.timeoutSeconds);
      if (record) record.out.failed = { reason: failure.reason, message: failure.message };
      answer(failure.status, { message: failure.message, reason: failure.reason, destination: target });
    });

    // A client that gives up takes its request to the destination with it.
    res.once('close', () => {
      clearTimeout(connectTimer);
      if (!res.writableEnded) upstream.destroy();
    });

    // A body larger than a plugin allows is cut off on its way.
    if (bodyLimit) {
      let total = 0;
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > bodyLimit.maxBytes && !upstream.destroyed) upstream.destroy(timeoutError('KG_TOO_LARGE'));
      });
    }

    releaseBody();
    req.pipe(upstream);
  }

  return {
    handle(req, res) {
      handle(req, res).catch((error) => {
        report(error);
        if (res.headersSent) {
          res.destroy();
        } else if (!res.destroyed) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ message: 'the gateway failed on this request', reason: 'gateway' }));
        }
      });
    },
    stop: () => clearInterval(sweep),
  };
}

// Hands a plugin the destination's whole body once it has gone through to the
// client, or null when it was larger than the plugin wanted or broke off.
function watchBody(stream, { callback, maxBytes }, report) {
  const chunks = [];
  let held = 0;
  let tooLarge = false;
  stream.on('data', (chunk) => {
    if (tooLarge) return;
    held += chunk.length;
    if (held > maxBytes) {
      tooLarge = true;
      chunks.length = 0;
    } else {
      chunks.push(chunk);
    }
  });
  stream.once('end', () => {
    try {
      callback(tooLarge ? null : Buffer.concat(chunks));
    } catch (error) {
      report(error);
    }
  });
  stream.once('close', () => {
    if (!stream.complete) {
      try {
        callback(null);
      } catch (error) {
        report(error);
      }
    }
  });
}

// A body as text, unpacked if it travels compressed; null when it cannot be read.
export function bodyText(bytes, encoding) {
  try {
    switch ((encoding ?? '').trim().toLowerCase()) {
      case '':
      case 'identity':
        return bytes.toString('utf8');
      // Only the start of the body may be here, so the unpacking is told not
      // to mind that the end is missing.
      case 'gzip':
      case 'x-gzip':
        return gunzipSync(bytes, { finishFlush: zlib.Z_SYNC_FLUSH }).toString('utf8');
      case 'deflate':
        return inflateSync(bytes, { finishFlush: zlib.Z_SYNC_FLUSH }).toString('utf8');
      case 'br':
        return brotliDecompressSync(bytes, { finishFlush: zlib.BROTLI_OPERATION_FLUSH }).toString('utf8');
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Keeps the start of a text body for the requests log, while the body itself
// goes on to where it was going untouched. `headerOf` reads a header of the
// message the body belongs to; `keep` is given what the log should show.
function captureBody(stream, headerOf, keep) {
  const isReadable = isText(headerOf('content-type'));
  const chunks = [];
  let held = 0;
  let total = 0;

  stream.on('data', (chunk) => {
    total += chunk.length;
    if (isReadable && held < MAX_HELD_BODY) {
      const part = chunk.subarray(0, MAX_HELD_BODY - held);
      chunks.push(part);
      held += part.length;
    }
  });
  stream.once('end', () => {
    if (total === 0) return;
    if (!isReadable) return void keep('(not shown: not text)');

    const text = bodyText(Buffer.concat(chunks), headerOf('content-encoding'));
    if (text === null) return void keep('(not shown: could not be read)');
    keep(text.length > MAX_LOGGED_BODY || total > held ? `${text.slice(0, MAX_LOGGED_BODY)}… (${total} bytes)` : text);
  });
}
