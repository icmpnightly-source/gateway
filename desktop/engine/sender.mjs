// One request, sent the way an API client sends it, and what came back: for
// the app's "try it" page. A request made by the page itself would carry the
// browser's own headers and hide some of the answer's; this one carries only
// what was asked for, and nothing of its answer is kept back.

import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { bodyText, describeFailure, isText, timeoutError, unwire, wire } from './gateway.mjs';
import { Refusal } from './store.mjs';

// How long a connection may take to be accepted, as for the gateway itself.
const CONNECT_SECONDS = 5;
// As much of an answer's body as is kept to be shown.
const MAX_SHOWN = 1024 * 1024;

// What a header's name may hold, and what its value may not.
const NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BREAKS = /[\r\n\0]/;
// Set by the sending itself, whatever was asked for.
const OURS = new Set(['content-length', 'transfer-encoding', 'connection']);

// Text that came out of bytes that were not text is full of these.
const looksLikeText = (text) => !/[�\0]/.test(text.slice(0, 4000));

/** What to show of an answer's body: its text when it is text, its size otherwise. */
function shownBody(bytes, size, contentType, encoding) {
  if (size === 0) return { kind: 'empty', size: 0, truncated: false };

  const text = bodyText(bytes, encoding);
  if (text !== null && (isText(contentType) || looksLikeText(text))) {
    return { kind: 'text', text, size, truncated: size > bytes.length };
  }
  return { kind: 'binary', size, truncated: false };
}

/**
 * Sends the request and resolves with its answer: `{ url, status, statusText,
 * headers, body, ms, ip }`, or `{ url, ms, failed: { reason, message } }` when
 * there was none. Headers are `{ name, value }`, in the order to send them;
 * a header that cannot be sent is refused before anything goes out.
 */
export function sendRequest({ url, method, headers, body, timeoutSeconds, agentName }) {
  const target = new URL(url);
  const secure = target.protocol === 'https:';
  const payload = body === undefined ? null : Buffer.from(body, 'utf8');

  // Node takes headers by name; one sent twice goes as a list of its values.
  const sent = {};
  const named = new Set();
  for (const { name, value } of headers) {
    if (!NAME.test(name) || BREAKS.test(value)) throw new Refusal(400, `"${name}" cannot be sent as a header`);
    const key = name.toLowerCase();
    if (OURS.has(key)) continue;

    const known = Object.keys(sent).find((other) => other.toLowerCase() === key);
    if (known) sent[known] = [].concat(sent[known], wire(value));
    else sent[name] = wire(value);
    named.add(key);
  }
  if (!named.has('user-agent')) sent['User-Agent'] = agentName;
  if (!named.has('accept')) sent.Accept = '*/*';
  if (payload) sent['Content-Length'] = String(payload.length);

  const startedAt = performance.now();
  const took = () => Math.round(performance.now() - startedAt);

  return new Promise((resolve) => {
    let connectTimer;
    let ip;
    let isDone = false;
    const done = (result) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(connectTimer);
      resolve({ url, ms: took(), ip, ...result });
    };
    const failed = (error) => {
      const { reason, message } = describeFailure(error, target.host, CONNECT_SECONDS, timeoutSeconds);
      done({ failed: { reason, message } });
    };

    const request = (secure ? https : http).request({
      protocol: target.protocol,
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || (secure ? 443 : 80),
      method,
      path: target.pathname + target.search,
      headers: sent,
      // A connection of its own, so that a failure means what it says.
      agent: false,
      // Inside a company network the certificate is usually the server's own.
      rejectUnauthorized: false,
    });

    request.once('socket', (socket) => {
      if (!socket.connecting) return;

      connectTimer = setTimeout(() => request.destroy(timeoutError('KG_CONNECT_TIMEOUT')), CONNECT_SECONDS * 1000);
      socket.once(secure ? 'secureConnect' : 'connect', () => {
        clearTimeout(connectTimer);
        ip = socket.remoteAddress;
      });
    });
    request.setTimeout(timeoutSeconds * 1000, () => request.destroy(timeoutError('KG_RESPONSE_TIMEOUT')));

    request.once('response', (answered) => {
      const chunks = [];
      let held = 0;
      let size = 0;

      answered.on('data', (chunk) => {
        size += chunk.length;
        if (held < MAX_SHOWN) {
          const part = chunk.subarray(0, MAX_SHOWN - held);
          chunks.push(part);
          held += part.length;
        }
      });
      answered.once('end', () => {
        const pairs = [];
        for (let index = 0; index < answered.rawHeaders.length; index += 2) {
          pairs.push([answered.rawHeaders[index], unwire(answered.rawHeaders[index + 1])]);
        }
        done({
          status: answered.statusCode,
          statusText: answered.statusMessage ?? '',
          headers: pairs,
          body: shownBody(Buffer.concat(chunks), size, answered.headers['content-type'], answered.headers['content-encoding']),
        });
      });
      // An answer that breaks off in the middle is no answer.
      answered.once('error', failed);
      answered.once('close', () => {
        if (!answered.complete) failed(Object.assign(new Error('the answer broke off'), { code: 'ECONNRESET' }));
      });
    });
    request.on('error', failed);

    request.end(payload ?? undefined);
  });
}
