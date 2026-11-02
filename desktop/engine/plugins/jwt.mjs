// JWT: reads the client's token, checks it if a secret is chosen, lets the
// request through only when the token's fields allow it, and forwards the
// fields chosen as headers.

import { createHash } from 'node:crypto';
import { bearerToken, decodedClaims, findClaim, meets, toHeaderValue, verifiedClaims } from '../jwt.mjs';
import { HEADER, refuse } from './fields.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export default {
  name: 'jwt',
  title: 'JWT',
  description: "Reads the client's token: checks it against a secret, lets through only tokens whose fields allow it, and forwards the fields chosen as headers.",
  priority: 1450,

  /** Its settings have a form of their own in the app, so they are checked here. */
  configFrom(input) {
    const token = typeof input === 'object' && input !== null ? input : {};
    const verify = token.verify ?? {};
    const secretId = text(verify.secretId);
    if (secretId && !UUID.test(secretId)) refuse('unknown secret');

    return {
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
    };
  },

  // Switched on and verifying, it needs its secret chosen.
  check(config, { enabled }) {
    if (enabled && config.verify.enabled && !config.verify.secretId) refuse('choose the secret tokens are verified against');
  },

  // The token's header is masked in the requests log.
  secretHeaders: (config) => [config.header],

  access(ctx, config, _state, env) {
    const token = bearerToken(ctx.request.incomingHeader(config.header));
    const unauthorized = (reason) =>
      ctx.respond(401, { message: `Unauthorized: ${reason}`, reason: 'token' }, [['WWW-Authenticate', 'Bearer']]);

    // These headers are ours to set: whatever the client put in them is
    // dropped, so the destination never sees a value that didn't come from
    // the token.
    for (const mapping of config.claims) ctx.request.removeHeader(mapping.header);
    if (config.payloadHeader) ctx.request.removeHeader(config.payloadHeader);

    let claims;
    let encoded;
    let reason;
    if (token) {
      const read = config.verify.enabled
        ? verifiedClaims(token, env.secret(config.verify.secretId), config.verify)
        : decodedClaims(token);

      if (read.claims) {
        ({ claims, encoded } = read);
      } else {
        ({ reason } = read);
        // A token that fails verification is never let through, strict or not.
        if (config.verify.enabled) return unauthorized(reason);
      }
    }

    if (!claims) {
      // No token, or (unverified) nothing readable in it. A work gated on
      // token fields cannot be entered without them.
      if (config.strict || config.conditions.length > 0) return unauthorized(reason ?? 'token is missing');
    } else {
      for (const condition of config.conditions) {
        if (!meets(findClaim(claims, condition.claim), condition.values)) {
          return ctx.respond(403, {
            message: `Forbidden: token '${condition.claim}' does not allow this request`,
            reason: 'condition',
          });
        }
      }

      for (const mapping of config.claims) {
        const value = toHeaderValue(findClaim(claims, mapping.claim));
        if (value !== undefined) {
          ctx.request.setHeader(mapping.header, value);
        } else if (mapping.required) {
          return unauthorized(`token has no usable '${mapping.claim}' claim`);
        }
      }

      if (config.payloadHeader) ctx.request.setHeader(config.payloadHeader, encoded);

      // Who is calling, for a limit or a cache that tells callers apart. Only
      // a verified token is believed about who it is; any other is told
      // apart by the token itself.
      const subject = toHeaderValue(claims.sub);
      ctx.setConsumer(
        config.verify.enabled && subject !== undefined
          ? `jwt:${subject}`
          : `jwt#${createHash('sha256').update(token).digest('hex').slice(0, 32)}`,
      );
    }

    if (!config.forwardToken) ctx.request.removeHeader(config.header);
    return undefined;
  },
};
