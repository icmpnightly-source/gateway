// How the app runs on this computer: which ports it uses, who may call the
// gateway, and (if any) the shared database the JWT secrets come from. The
// projects themselves are in the data file (store.mjs).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  // Where clients send their requests. `public` opens it to the network;
  // otherwise only programs on this computer can call it.
  gateway: { port: 8100, public: true },
  // Where the app's own window is served from; this computer only, always.
  app: { port: 8101 },
  // What the window's close button does: "tray" leaves the gateway running in
  // the background, "quit" stops it and frees its port, "ask" asks each time.
  window: { onClose: 'ask' },
  // The shared database of JWT secrets. No host: there is none, and the
  // secrets are kept in this computer's own file.
  database: { host: '', port: 5432, database: 'konggate', user: 'konggate', password: '', ssl: false },
};

/**
 * Keeps a value as it is, only out of plain sight: for when the host offers
 * nothing better. (The desktop app passes a vault backed by the operating
 * system, which only this Windows user can open.)
 */
export const PLAIN_VAULT = {
  seal: (text) => `plain:${Buffer.from(text, 'utf8').toString('base64')}`,
  open: (sealed) => (sealed.startsWith('plain:') ? Buffer.from(sealed.slice(6), 'base64').toString('utf8') : null),
};

/** What a vault makes of something it sealed, or '' when it cannot open it (another computer's, another user's). */
export function unsealed(vault, sealed) {
  if (typeof sealed !== 'string' || sealed === '') return '';
  try {
    return vault.open(sealed) ?? PLAIN_VAULT.open(sealed) ?? '';
  } catch {
    return '';
  }
}

/** Writes a file aside and moves it into place: a crash never leaves half of one. */
export function writeWhole(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

const isPort = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;

/** Fills in what is missing or unusable, so the rest of the engine never checks. */
export function normalized(given) {
  const gateway = { ...DEFAULTS.gateway, ...given?.gateway };
  const app = { ...DEFAULTS.app, ...given?.app };
  const database = { ...DEFAULTS.database, ...given?.database };

  return {
    gateway: {
      port: isPort(Number(gateway.port)) ? Number(gateway.port) : DEFAULTS.gateway.port,
      public: gateway.public !== false,
    },
    app: { port: isPort(Number(app.port)) ? Number(app.port) : DEFAULTS.app.port },
    window: { onClose: ['ask', 'tray', 'quit'].includes(given?.window?.onClose) ? given.window.onClose : DEFAULTS.window.onClose },
    database: {
      host: String(database.host ?? '').trim(),
      port: isPort(Number(database.port)) ? Number(database.port) : DEFAULTS.database.port,
      database: String(database.database ?? '').trim() || DEFAULTS.database.database,
      user: String(database.user ?? '').trim() || DEFAULTS.database.user,
      password: String(database.password ?? ''),
      ssl: Boolean(database.ssl),
    },
  };
}

/** `vault` (`{ seal, open }`) is what the database's password is kept in the file with. */
export function createSettingsStore(file, vault = PLAIN_VAULT) {
  return {
    load() {
      let stored = {};
      try {
        stored = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // First start, or a file somebody broke: begin from the defaults.
      }
      return normalized({
        ...stored,
        database: { ...stored?.database, password: unsealed(vault, stored?.database?.password) },
      });
    },

    save(settings) {
      const { password } = settings.database;
      writeWhole(
        file,
        `${JSON.stringify({ ...settings, database: { ...settings.database, password: password ? vault.seal(password) : '' } }, null, 2)}\n`,
      );
    },
  };
}
