// What this computer alone knows: where the database is and which ports the
// app uses here. Everything else (projects, works, secrets) lives in the
// database, which every computer shares.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  database: { host: '', port: 5432, database: 'konggate', user: 'konggate', password: '', ssl: false },
  // Where clients send their requests. `public` opens it to the network;
  // otherwise only programs on this computer can call it.
  gateway: { port: 8100, public: true },
  // Where the app's own window is served from; this computer only, always.
  app: { port: 8101 },
};

// A vault that keeps the database password as it is, for when the host offers
// nothing better (the desktop app passes one backed by the operating system).
const PLAIN_VAULT = {
  seal: (text) => `plain:${Buffer.from(text, 'utf8').toString('base64')}`,
  open: (sealed) => (sealed.startsWith('plain:') ? Buffer.from(sealed.slice(6), 'base64').toString('utf8') : null),
};

const isPort = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;

/** Fills in what is missing or unusable, so the rest of the engine never checks. */
export function normalized(given) {
  const database = { ...DEFAULTS.database, ...given?.database };
  const gateway = { ...DEFAULTS.gateway, ...given?.gateway };
  const app = { ...DEFAULTS.app, ...given?.app };

  return {
    database: {
      host: String(database.host ?? '').trim(),
      port: isPort(Number(database.port)) ? Number(database.port) : DEFAULTS.database.port,
      database: String(database.database ?? '').trim() || DEFAULTS.database.database,
      user: String(database.user ?? '').trim() || DEFAULTS.database.user,
      password: String(database.password ?? ''),
      ssl: Boolean(database.ssl),
    },
    gateway: {
      port: isPort(Number(gateway.port)) ? Number(gateway.port) : DEFAULTS.gateway.port,
      public: gateway.public !== false,
    },
    app: { port: isPort(Number(app.port)) ? Number(app.port) : DEFAULTS.app.port },
  };
}

export function createSettingsStore(file, vault = PLAIN_VAULT) {
  const open = (sealed) => {
    if (typeof sealed !== 'string' || sealed === '') return '';
    try {
      // A password sealed on another computer, or by another user, opens for nobody else.
      return vault.open(sealed) ?? PLAIN_VAULT.open(sealed) ?? '';
    } catch {
      return '';
    }
  };

  return {
    load() {
      let stored = {};
      try {
        stored = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // First start, or a file somebody broke: begin from the defaults.
      }

      const password = open(stored?.database?.password);
      return normalized({ ...stored, database: { ...stored?.database, password } });
    },

    save(settings) {
      const stored = {
        ...settings,
        database: {
          ...settings.database,
          password: settings.database.password ? vault.seal(settings.database.password) : '',
        },
      };

      mkdirSync(path.dirname(file), { recursive: true });
      // Written aside and moved into place: a crash never leaves half a file.
      writeFileSync(`${file}.tmp`, `${JSON.stringify(stored, null, 2)}\n`);
      renameSync(`${file}.tmp`, file);
    },
  };
}
