// The gateway itself: takes a client's request, finds the work it belongs to,
// does to it what the work says, and forwards it to the work's destination.
//
// For each request, in this order: answer a browser's CORS preflight; read and
// check the token; count it against the request limit; set the fixed headers;
// give it a request id; forward it.

import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { brotliDecompressSync, constants as zlib, gunzipSync, inflateSync } from 'node:zlib';
import { bearerToken, decodedClaims, findClaim, meets, toHeaderValue, verifiedClaims } from './jwt.mjs';

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

const PREFLIGHT_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
// How long a browser may go by an answer to its preflight before asking again.
const PREFLIGHT_SECONDS = 600;
// The headers the gateway puts on an answer, for a page to be able to read
// them where "*" cannot say so (an answer that allows credentials).
const OWN_HEADERS = ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'];

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

/**
 * `getWorks` and `getSecret` give the current configuration; `log` is where
 * recorded requests go.
 */
export function createGateway({ getWorks, getSecret, log }) {
  // Requests counted per work and client, within the current minute.
  const counters = new Map();
  const sweep = setInterval(() => {
    const minute = Math.floor(Date.now() / 60000);
    for (const [key, counter] of counters) {
      if (counter.minute !== minute) counters.delete(key);
    }
  }, 60000);
  sweep.unref();

  function count(work, identity) {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const key = `${work.id}\n${identity}`;

    let counter = counters.get(key);
    if (!counter || counter.minute !== minute) {
      counter = { minute, count: 0 };
      counters.set(key, counter);
    }
    counter.count += 1;

    const limit = work.rateLimit.perMinute;
    return {
      limit,
      allowed: counter.count <= limit,
      remaining: Math.max(0, limit - counter.count),
      reset: Math.ceil(((minute + 1) * 60000 - now) / 1000),
    };
  }

  function handle(req, res) {
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

    function answer(status, body, headers = []) {
      const text = JSON.stringify(body);
      const payload = Buffer.from(text);
      const sent = [
        'Content-Type', 'application/json; charset=utf-8',
        'Content-Length', String(payload.length),
        ...headers.flat(),
        ...extra.flat(),
      ];
      if (record) record.answer = { by: 'gateway', headers: loggedHeaders(headersFrom(sent), record.redact), body: text };

      res.writeHead(status, sent);
      res.end(req.method === 'HEAD' ? undefined : payload);
    }

    if (!work) {
      // Read to the end, so the connection can be used again.
      req.resume();
      answer(404, { message: 'no work answers this path and method', reason: 'no_work' });
      return;
    }

    const recorded = work.tracing.enabled && Math.random() * 100 < work.tracing.samplingPercent;
    if (recorded) {
      const redact = new Set([...ALWAYS_MASKED, work.token.header.toLowerCase()]);
      record = {
        id: randomBytes(16).toString('hex'),
        time: new Date(startedAt).toISOString(),
        workId: work.id,
        workName: work.name,
        projectId: work.projectId,
        redact,
        in: {
          method: req.method,
          url: `${scheme}://${getHeader(incoming, 'host') ?? ''}${req.url}`,
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

      if (work.tracing.body) {
        captureBody(req, (name) => getHeader(incoming, name), (body) => {
          record.in.body = record.scrub(body);
        });
      }

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

    const refuse = (status, body, headers) => {
      if (record) record.out.note = `nothing sent: the gateway answered ${status} itself`;
      req.resume();
      answer(status, body, headers);
    };
    const unauthorized = (reason) =>
      refuse(401, { message: `Unauthorized: ${reason}`, reason: 'token' }, [['WWW-Authenticate', 'Bearer']]);

    // --- CORS -----------------------------------------------------------------

    if (work.cors.enabled && origin) {
      const { origins, credentials } = work.cors;
      const any = origins.includes('*');

      const isAllowed = any || origins.includes(origin);
      if (isAllowed) {
        // A browser refuses "*" together with credentials, so the caller is named.
        extra.push(['Access-Control-Allow-Origin', any && !credentials ? '*' : origin]);
        if (credentials) extra.push(['Access-Control-Allow-Credentials', 'true']);
      }
      if (!any || credentials) extra.push(['Vary', 'Origin']);

      if (preflightFor) {
        const wanted = getHeader(incoming, 'access-control-request-headers');
        const allowed = [['Access-Control-Allow-Methods', work.methods.length > 0 ? work.methods.join(',') : PREFLIGHT_METHODS]];
        if (wanted) allowed.push(['Access-Control-Allow-Headers', wanted]);
        if (isAllowed) {
          allowed.push(['Access-Control-Max-Age', String(PREFLIGHT_SECONDS)]);
          // A page from a less private address calling one on the LAN is asked
          // about first, by browsers that do so.
          if (getHeader(incoming, 'access-control-request-private-network') === 'true') {
            allowed.push(['Access-Control-Allow-Private-Network', 'true']);
          }
        }

        const sent = ['Content-Length', '0', ...allowed.flat(), ...extra.flat()];
        if (record) {
          record.out.note = 'nothing sent: the gateway answered the browser\'s preflight itself';
          record.answer = { by: 'gateway', headers: loggedHeaders(headersFrom(sent), record.redact) };
        }
        req.resume();
        res.writeHead(200, sent);
        res.end();
        return;
      }

      // Otherwise a page could not read the headers the gateway adds: the
      // request's id, what is left of the limit.
      if (isAllowed) {
        const own = [...OWN_HEADERS, TRACE_ID_HEADER, ...(work.requestId.enabled ? [work.requestId.header] : [])];
        extra.push(['Access-Control-Expose-Headers', credentials ? own.join(', ') : '*']);
      }
    }

    // With CORS off the gateway keeps out of it: a browser's preflight goes to
    // the destination as it came, for the destination to answer as it does.
    // It never carries a token, so the token and the limit are not asked of it.
    const passesPreflight = Boolean(preflightFor) && !work.cors.enabled;

    // What the destination will be sent; starts as what the client sent.
    const outgoing = headersFrom(req.rawHeaders);

    // --- the token ------------------------------------------------------------

    if (work.token.enabled && !passesPreflight) {
      const { token: settings } = work;
      const token = bearerToken(getHeader(incoming, settings.header));

      // These headers are ours to set: whatever the client put in them is
      // dropped, so the destination never sees a value that didn't come from
      // the token.
      for (const mapping of settings.claims) removeHeader(outgoing, mapping.header);
      if (settings.payloadHeader) removeHeader(outgoing, settings.payloadHeader);

      let claims;
      let encoded;
      let reason;
      if (token) {
        const read = settings.verify.enabled
          ? verifiedClaims(token, getSecret(settings.verify.secretId), settings.verify)
          : decodedClaims(token);

        if (read.claims) {
          ({ claims, encoded } = read);
        } else {
          ({ reason } = read);
          // A token that fails verification is never let through, strict or not.
          if (settings.verify.enabled) return unauthorized(reason);
        }
      }

      if (!claims) {
        // No token, or (unverified) nothing readable in it. A work gated on
        // token fields cannot be entered without them.
        if (settings.strict || settings.conditions.length > 0) return unauthorized(reason ?? 'token is missing');
      } else {
        for (const condition of settings.conditions) {
          if (!meets(findClaim(claims, condition.claim), condition.values)) {
            return refuse(403, {
              message: `Forbidden: token '${condition.claim}' does not allow this request`,
              reason: 'condition',
            });
          }
        }

        for (const mapping of settings.claims) {
          const value = toHeaderValue(findClaim(claims, mapping.claim));
          if (value !== undefined) {
            setHeader(outgoing, mapping.header, wire(value));
          } else if (mapping.required) {
            return unauthorized(`token has no usable '${mapping.claim}' claim`);
          }
        }

        if (settings.payloadHeader) setHeader(outgoing, settings.payloadHeader, encoded);
      }

      if (!settings.forwardToken) removeHeader(outgoing, settings.header);
    }

    // --- the request limit ----------------------------------------------------

    if (work.rateLimit.enabled && !passesPreflight) {
      const { by, header } = work.rateLimit;
      // Counted after the token was read, so a header filled from it counts
      // per token user. A request without the header is counted by address.
      const identity = (by === 'header' && header && getHeader(outgoing, header)) || clientIp;
      const counted = count(work, identity);

      extra.push(
        ['RateLimit-Limit', String(counted.limit)],
        ['RateLimit-Remaining', String(counted.remaining)],
        ['RateLimit-Reset', String(counted.reset)],
      );
      if (!counted.allowed) {
        return refuse(429, { message: 'request limit exceeded', reason: 'rate_limit' }, [['Retry-After', String(counted.reset)]]);
      }
    }

    // --- fixed headers and the request id -------------------------------------

    for (const { name, value } of work.headers) setHeader(outgoing, name, wire(value));

    if (work.requestId.enabled) {
      const { header, echo } = work.requestId;
      // An id the client already sent is kept.
      let id = getHeader(outgoing, header);
      if (!id) {
        id = randomUUID();
        setHeader(outgoing, header, id);
      }
      if (echo) extra.push([header, id]);
    }

    // --- forwarding -----------------------------------------------------------

    const { base } = work;
    if (!base) {
      return refuse(502, { message: "the work's destination is not a usable address", reason: 'bad_destination' });
    }

    const prefix = work.path === '/' ? '' : work.path;
    const upstreamPath = upstreamPathOf(work, base, pathname, search);

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

    upstream.once('response', (answered) => {
      if (record) {
        record.out.status = answered.statusCode;
        record.out.response = {
          status: answered.statusCode,
          headers: loggedHeaders(headersFrom(answered.rawHeaders), record.redact),
        };
        if (work.tracing.body) {
          captureBody(answered, (name) => answered.headers[name], (body) => {
            record.out.response.body = record.scrub(body);
          });
        }
      }

      const headers = [];
      for (let index = 0; index < answered.rawHeaders.length; index += 2) {
        if (!HOP_BY_HOP.has(answered.rawHeaders[index].toLowerCase())) {
          headers.push(answered.rawHeaders[index], answered.rawHeaders[index + 1]);
        }
      }
      // Ours win over the destination's where both set the same header.
      const ours = new Set(extra.map(([name]) => name.toLowerCase()));
      const kept = [];
      for (let index = 0; index < headers.length; index += 2) {
        if (!ours.has(headers[index].toLowerCase())) kept.push(headers[index], headers[index + 1]);
      }

      const sent = [...kept, 'Via', '1.1 konggate', ...extra.flat()];
      if (record) record.answer = { by: 'destination', headers: loggedHeaders(headersFrom(sent), record.redact) };

      res.writeHead(answered.statusCode, answered.statusMessage, sent);
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

      const failure = describeFailure(error, target, connectSeconds, work.timeoutSeconds);
      if (record) record.out.failed = { reason: failure.reason, message: failure.message };
      answer(failure.status, { message: failure.message, reason: failure.reason, destination: target });
    });

    // A client that gives up takes its request to the destination with it.
    res.once('close', () => {
      clearTimeout(connectTimer);
      if (!res.writableEnded) upstream.destroy();
    });

    req.pipe(upstream);
  }

  return {
    handle,
    stop: () => clearInterval(sweep),
  };
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
