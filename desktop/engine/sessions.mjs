// The administrator: one password, kept (as a salted hash) where the secrets
// are kept: in the shared database, so that it is the same on every computer,
// or else in this computer's data file. Sign-in sessions last while the app
// runs.
//
// This guards the app's own screens. Somebody who can open the database or
// the data file directly can change it without the app.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Refusal } from './store.mjs';

const SESSION_MS = 12 * 60 * 60 * 1000;
// Wrong passwords tolerated within a minute.
const MAX_FAILED = 5;
const MIN_LENGTH = 8;

function hashed(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex') };
}

function matches(password, record) {
  if (typeof password !== 'string' || !record?.salt || !record?.hash) return false;

  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(hashed(password, record.salt).hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessions() {
  // Session token → when it stops being accepted.
  const sessions = new Map();
  let failed = [];

  const tooManyFailures = () => {
    failed = failed.filter((at) => Date.now() - at < 60000);
    return failed.length >= MAX_FAILED;
  };

  function open() {
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_MS;
    sessions.set(token, expiresAt);
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  return {
    /** Ends every session: for when the place the password is kept in changes. */
    end: () => sessions.clear(),

    isValid(token) {
      const expiresAt = token && sessions.get(token);
      if (!expiresAt) return false;
      if (expiresAt <= Date.now()) {
        sessions.delete(token);
        return false;
      }
      return true;
    },

    async signIn(db, password) {
      const record = await db.adminPassword();
      if (!record) throw new Refusal(409, 'no administrator password is set yet', { reason: 'no_password' });
      if (tooManyFailures()) throw new Refusal(429, 'too many wrong passwords, try again in a minute');

      if (!matches(password, record)) {
        failed.push(Date.now());
        throw new Refusal(401, 'wrong password');
      }
      return open();
    },

    /**
     * Sets the first password, which anyone may do while there is none, or
     * replaces it, which takes the current one.
     */
    async setPassword(db, password, current) {
      if (typeof password !== 'string' || password.length < MIN_LENGTH) {
        throw new Refusal(400, `the password needs at least ${MIN_LENGTH} characters`);
      }

      const record = (await db.adminPassword()) ?? null;
      if (record) {
        if (tooManyFailures()) throw new Refusal(429, 'too many wrong passwords, try again in a minute');
        if (!matches(current, record)) {
          failed.push(Date.now());
          throw new Refusal(401, 'wrong password');
        }
      }

      // In a shared database somebody on another computer may have set one in the meantime.
      if (!(await db.setAdminPassword(hashed(password), record))) {
        throw new Refusal(409, 'the password was just changed by someone else');
      }
      // A new password ends every session opened with the old one.
      sessions.clear();
    },
  };
}
