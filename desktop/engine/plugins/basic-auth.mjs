// Basic sign-in: a user name and a password, as a browser asks for them.
// Passwords are kept as salted hashes, never as themselves.

import { createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
// A password that just matched is not hashed again for this long.
const REMEMBERED_MS = 5 * 60 * 1000;
const MAX_REMEMBERED = 1000;

async function matches(password, user) {
  // Hashed off the main thread: a stream of wrong passwords must not hold up other requests.
  const actual = await scryptAsync(password, Buffer.from(user.salt, 'hex'), 32);
  const expected = Buffer.from(user.hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default {
  name: 'basic-auth',
  title: 'Basic sign-in',
  description: 'Lets in only clients that send one of the user names and passwords set here (HTTP Basic).',
  priority: 1100,
  fields: {
    users: { type: 'users', label: 'Users' },
    realm: { type: 'string', label: 'Name shown when a browser asks', default: 'KongGate' },
    hideCredentials: { type: 'boolean', label: "Don't pass the password on to the destination", default: true },
    consumerHeader: { type: 'string', label: "Header with the user's name, for the destination", default: 'X-Consumer', header: true },
  },

  prepare(config) {
    return {
      users: new Map(config.users.map((user) => [user.username, user])),
      remembered: new Map(),
      sweep() {
        const now = Date.now();
        for (const [key, until] of this.remembered) if (until <= now) this.remembered.delete(key);
      },
    };
  },

  async access(ctx, config, state) {
    const ask = (message) =>
      ctx.respond(401, { message: `Unauthorized: ${message}`, reason: 'basic' }, [
        ['WWW-Authenticate', `Basic realm="${(config.realm || 'KongGate').replace(/"/g, "'")}", charset="UTF-8"`],
      ]);

    const match = /^Basic\s+(\S+)\s*$/i.exec(ctx.request.incomingHeader('authorization') ?? '');
    if (!match) return ask('a user name and password are needed');

    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const username = colon === -1 ? decoded : decoded.slice(0, colon);
    const password = colon === -1 ? '' : decoded.slice(colon + 1);
    const user = state.users.get(username);

    const fingerprint = createHash('sha256').update(`${username}\0${password}\0${user?.hash ?? ''}`).digest('hex');
    const isRemembered = (state.remembered.get(fingerprint) ?? 0) > Date.now();
    if (!user || !(isRemembered || (await matches(password, user)))) return ask('the user name or password is wrong');

    if (!isRemembered) {
      if (state.remembered.size >= MAX_REMEMBERED) state.remembered.delete(state.remembered.keys().next().value);
      state.remembered.set(fingerprint, Date.now() + REMEMBERED_MS);
    }

    ctx.setConsumer(`user:${username}`);
    if (config.hideCredentials) ctx.request.removeHeader('Authorization');
    if (config.consumerHeader) ctx.request.setHeader(config.consumerHeader, username);
    return undefined;
  },
};
