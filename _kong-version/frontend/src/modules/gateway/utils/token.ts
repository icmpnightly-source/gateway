import type { JwtAlgorithm, TokenField, TokenSettings } from '@/types/gateway.types';

type Json = Record<string, unknown>;

/** HS* tokens are checked with a shared secret; every other algorithm with a public key. */
export const isHmac = (algorithm: JwtAlgorithm) => algorithm.startsWith('HS');

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function bytesToBase64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Accepts the URL-safe and the standard alphabet, padded or not.
function base64ToBytes(text: string) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const encodePart = (value: object) => bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));

/** A token the gateway can read but nobody signed: accepted only by rules that don't verify. */
export function unsignedToken(payload: object) {
  return `${encodePart({ alg: 'none', typ: 'JWT' })}.${encodePart(payload)}.`;
}

/** The payload of a JWT, read without checking anything; undefined if it isn't one. */
export function decodePayload(token: string): Json | undefined {
  const encoded = token.trim().replace(/^bearer\s+/i, '').split('.')[1];
  if (!encoded) return undefined;

  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(base64ToBytes(encoded)));
    return isObject(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function typeOf(value: unknown): TokenField['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';

  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' ? type : 'object';
}

/** A value from inside a nested payload, by its dotted path. */
export function valueAt(payload: Json, path: string): unknown {
  if (path in payload) return payload[path];

  let value: unknown = payload;
  for (const key of path.split('.')) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** Every field of a payload a rule could forward: nested objects are walked, arrays kept whole. */
export function fieldsOf(payload: Json, prefix = ''): TokenField[] {
  return Object.entries(payload).flatMap(([key, value]): TokenField[] => {
    const path = prefix + key;
    // An empty object has nothing inside to list, so it is listed itself.
    return isObject(value) && Object.keys(value).length > 0
      ? fieldsOf(value, `${path}.`)
      : [{ path, type: typeOf(value) }];
  });
}

/** A header name for a field: "user.email" → "X-User-Email", "userId" → "X-User-Id". */
export function suggestHeader(claim: string) {
  const words = claim
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());

  return ['X', ...words].join('-');
}

function setPath(payload: Json, path: string, value: unknown) {
  const keys = path.split('.').filter(Boolean);
  const last = keys.pop();
  if (!last) return;

  let node = payload;
  for (const key of keys) {
    if (!isObject(node[key])) node[key] = {};
    node = node[key] as Json;
  }
  node[last] = value;
}

/** A payload that passes the rule: every field it forwards, and its conditions. */
export function samplePayload(token: TokenSettings): Json {
  const payload: Json = {};

  for (const { claim } of token.claims) {
    setPath(payload, claim, /id$/i.test(claim) ? 42 : 'sample');
  }
  for (const { claim, values } of token.conditions) {
    setPath(payload, claim, values[0]);
  }

  return payload;
}

/** Parses text as a JSON object; anything else (arrays, scalars, bad JSON) is undefined. */
export function parseJsonObject(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
