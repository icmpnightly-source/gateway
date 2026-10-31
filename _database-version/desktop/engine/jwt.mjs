// Reading and verifying JWTs, and turning what is in them into header values.
//
// A token that is only decoded proves nothing: anyone can mint one carrying
// any claims. Only a verified token's claims can be trusted.

import { constants, createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';

const HMAC = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };
const RSA = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512' };
const RSA_PSS = { PS256: 'sha256', PS384: 'sha384', PS512: 'sha512' };
const ECDSA = { ES256: 'sha256', ES384: 'sha384', ES512: 'sha512' };

export const ALGORITHMS = [...Object.keys(HMAC), ...Object.keys(RSA), ...Object.keys(ECDSA), ...Object.keys(RSA_PSS), 'EdDSA'];

export const isHmac = (algorithm) => algorithm in HMAC;

/** Accepts the URL-safe and the standard alphabet, padded or not; null for anything else. */
export function decodeBase64Url(input) {
  if (typeof input !== 'string') return null;

  const bare = input.replace(/=+$/, '');
  if (bare.length % 4 === 1 || /[^A-Za-z0-9+/_-]/.test(bare)) return null;
  return Buffer.from(bare.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** The token out of "Bearer <token>", or a bare token as some headers carry it. */
export function bearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;

  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(headerValue) ?? /^\s*(\S+)\s*$/.exec(headerValue);
  return match ? match[1] : null;
}

function parseJson(buffer) {
  if (!buffer) return undefined;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The claims of a token nobody checked, with their still-encoded form; or the reason there are none. */
export function decodedClaims(token) {
  // header.payload.signature; the signature may be empty or absent.
  const match = /^[^.]+\.([^.]+)\.?[^.]*$/.exec(token);
  if (!match) return { reason: 'token is not a JWT' };

  const claims = parseJson(decodeBase64Url(match[1]));
  if (!isObject(claims)) return { reason: 'token payload is not readable' };

  return { claims, encoded: match[1] };
}

/**
 * What a stored secret verifies with: the shared secret's bytes, or a public
 * key. Null when the secret holds nothing usable.
 */
export function keyOf(secret) {
  try {
    if (isHmac(secret.algorithm)) {
      const key = secret.valueIsBase64 ? decodeBase64Url(secret.value.trim()) : Buffer.from(secret.value, 'utf8');
      return key && key.length > 0 ? key : null;
    }
    return createPublicKey(secret.value);
  } catch {
    return null;
  }
}

function signatureIsValid(algorithm, key, signed, signature) {
  if (algorithm in HMAC) {
    const expected = createHmac(HMAC[algorithm], key).update(signed).digest();
    return expected.length === signature.length && timingSafeEqual(expected, signature);
  }
  if (algorithm in RSA) return verifySignature(RSA[algorithm], signed, key, signature);
  if (algorithm in RSA_PSS) {
    return verifySignature(
      RSA_PSS[algorithm],
      signed,
      { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      signature,
    );
  }
  // JWTs carry the two numbers of an ECDSA signature side by side, not as DER.
  if (algorithm in ECDSA) return verifySignature(ECDSA[algorithm], signed, { key, dsaEncoding: 'ieee-p1363' }, signature);
  if (algorithm === 'EdDSA') return verifySignature(null, signed, key, signature);
  return false;
}

const audienceMatches = (aud, expected) => (Array.isArray(aud) ? aud.includes(expected) : aud === expected);

/**
 * The claims of a token checked against `secret` ({ algorithm, key }), or the
 * reason it does not pass. `rules`: { checkExpiry, leeway, issuer, audience }.
 */
export function verifiedClaims(token, secret, rules, now = Math.floor(Date.now() / 1000)) {
  const parts = token.split('.');
  if (parts.length !== 3) return { reason: 'token is not a valid JWT' };

  const header = parseJson(decodeBase64Url(parts[0]));
  const signature = decodeBase64Url(parts[2]);
  if (!isObject(header) || !signature) return { reason: 'token is not a valid JWT' };

  const claims = parseJson(decodeBase64Url(parts[1]));
  if (!isObject(claims)) return { reason: 'token payload is not readable' };

  // Deleted, or never chosen: nothing can be verified, so nothing passes.
  if (!secret) return { reason: 'token cannot be verified' };

  // The algorithm is ours to choose, not the token's: trusting the header
  // would let an HS256 token be "signed" with a published public key.
  if (header.alg !== secret.algorithm) return { reason: `token is not signed with ${secret.algorithm}` };

  if (!secret.key) return { reason: 'token signature is invalid' };

  let valid = false;
  try {
    valid = signatureIsValid(secret.algorithm, secret.key, Buffer.from(`${parts[0]}.${parts[1]}`), signature);
  } catch {
    // A key of the wrong kind for the algorithm.
  }
  if (!valid) return { reason: 'token signature is invalid' };

  if (rules.checkExpiry) {
    const { exp, nbf } = claims;
    const leeway = Number(rules.leeway) || 0;

    if (exp !== undefined && exp !== null) {
      if (typeof exp !== 'number') return { reason: "token 'exp' is not a number" };
      if (now >= exp + leeway) return { reason: 'token has expired' };
    }
    if (nbf !== undefined && nbf !== null) {
      if (typeof nbf !== 'number') return { reason: "token 'nbf' is not a number" };
      if (now + leeway < nbf) return { reason: 'token is not valid yet' };
    }
  }

  if (rules.issuer && claims.iss !== rules.issuer) return { reason: 'token issuer is not accepted' };
  if (rules.audience && !audienceMatches(claims.aud, rules.audience)) return { reason: 'token audience is not accepted' };

  return { claims, encoded: parts[1] };
}

/** A claim by name; "user.id" walks into nested objects. */
export function findClaim(claims, name) {
  // Exact match first: namespaced claims such as "https://example.com/id"
  // contain dots of their own.
  if (Object.hasOwn(claims, name) && claims[name] !== undefined) return claims[name];

  let value = claims;
  for (const key of name.split('.')) {
    if (key === '') continue;
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

// Strings, numbers and booleans as text; undefined for anything else, and for
// strings that cannot travel in a header (empty, control characters).
function scalarText(value) {
  switch (typeof value) {
    case 'string':
      return value === '' || /[\u0000-\u001f\u007f]/.test(value) ? undefined : value;
    case 'number':
      return Number.isFinite(value) ? String(value) : undefined;
    case 'boolean':
      return String(value);
    default:
      return undefined;
  }
}

/** A claim's value as a header carries it: objects and arrays go as JSON. */
export function toHeaderValue(value) {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return scalarText(value);
}

/**
 * Whether a claim meets a condition: its value, or any item of an array value
 * (think "roles"), is one of the accepted values.
 */
export function meets(value, accepted) {
  const isAccepted = (item) => {
    const text = scalarText(item);
    return text !== undefined && accepted.includes(text);
  };

  return Array.isArray(value) ? value.some(isAccepted) : isAccepted(value);
}
