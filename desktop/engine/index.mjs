// Puts the engine together: this computer's settings and data file, the
// shared database of secrets if there is one, the gateway that clients call
// and the API the app's window (and the command line) uses.
//
// Nothing here needs Electron: `konggate serve` runs the same engine without
// a window.

import { rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApi } from './api.mjs';
import { compileWorks, createGateway } from './gateway.mjs';
import { keyOf } from './jwt.mjs';
import { createRequestsLog } from './requests-log.mjs';
import { describeConnectionError, openSecretsDatabase, tryConnection } from './secrets-db.mjs';
import { createSessions } from './sessions.mjs';
import { createSettingsStore, normalized } from './settings.mjs';
import { Refusal, openStore } from './store.mjs';

// How often the database is asked whether another computer changed a secret.
const SYNC_MS = 3000;
// How long before trying again to reach a database that did not answer.
const RECONNECT_MS = 5000;

/** The file, beside the data, that says where a running engine can be reached. */
export const RUNNING_FILE = 'running.json';

// Network adapters that are not the way other computers reach this one.
const VIRTUAL_ADAPTER = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|docker|Bluetooth|TAP|vpn/i;

/** This computer's IPv4 addresses, the ones other computers can use first. */
export function localAddresses() {
  const found = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        found.push({ address: address.address, adapter: name, virtual: VIRTUAL_ADAPTER.test(name) });
      }
    }
  }
  return found.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

const close = (server) => new Promise((resolve) => {
  server.close(() => resolve());
  server.closeAllConnections?.();
});

/**
 * Starts everything and resolves once the app's own address is being served.
 *
 * - `settingsFile`: where this computer's ports and database connection are kept.
 * - `dataFile`: where the projects and works are kept (and the secrets, with no database).
 * - `uiDir`: the built UI's files.
 * - `vault`: `{ seal, open }` for what must not lie readable on disk.
 * - `devOrigins`: extra origins the API accepts calls from (the dev server's).
 * - `quit`: what ends the program this engine runs in, for when it is asked to stop.
 * - `hasWindow`: whether there is a window whose close button has a meaning to choose.
 * - `version`, `buildDate`: which release this is, and the day it was built
 *   (`YYYY-MM-DD`; null in a checkout, which nobody built).
 */
export async function startEngine({
  settingsFile,
  dataFile,
  uiDir,
  vault,
  devOrigins = [],
  version = '',
  buildDate = null,
  report = console.error,
  quit,
  hasWindow = false,
}) {
  const settingsStore = createSettingsStore(settingsFile, vault);
  let settings = settingsStore.load();

  const store = openStore(dataFile, vault);
  const log = createRequestsLog();
  const sessions = createSessions();

  // --- where the secrets are: the shared database, or this computer's file -------

  let database = null;
  let databaseError = null;
  let databaseVersion = null;
  let reconnectTimer = null;
  let stopped = false;

  const usesDatabase = () => settings.database.host !== '';

  /** The secrets and the administrator's password, wherever they are kept. */
  function secretsStore() {
    if (!usesDatabase()) return store;
    if (!database) {
      throw new Refusal(503, databaseError?.message ?? 'the secrets database is not connected yet', {
        reason: databaseError?.reason ?? 'not_connected',
      });
    }
    return database;
  }

  // --- what the gateway works from, made ready ---------------------------------------

  let works = [];
  let secrets = new Map();

  async function reloadSecrets() {
    // With a database named but out of reach, the gateway goes on with the
    // secrets it last read: none, if it never read any.
    const source = usesDatabase() ? database : store;
    if (!source) return;

    const keys = await source.secretKeys();
    secrets = new Map(
      keys.map((secret) => [
        secret.id,
        // A secret whose value is yet to be entered has no key: nothing verifies against it.
        { name: secret.name, algorithm: secret.algorithm, key: secret.value === null ? null : keyOf(secret) },
      ]),
    );
    if (database) databaseVersion = await database.version();
  }

  async function reload() {
    works = compileWorks(store.works());
    await reloadSecrets();
  }

  async function connectDatabase() {
    clearTimeout(reconnectTimer);
    if (database) await database.close();
    database = null;
    databaseError = null;
    databaseVersion = null;
    // Whatever was read from the place the secrets used to be in is no longer theirs.
    secrets = new Map();

    if (!usesDatabase()) return reloadSecrets();

    try {
      const opened = await openSecretsDatabase(settings.database);
      if (stopped) return void opened.close();
      database = opened;
      await reloadSecrets();
    } catch (error) {
      databaseError = describeConnectionError(error);
      if (!database && !stopped) {
        reconnectTimer = setTimeout(() => connectDatabase().catch(report), RECONNECT_MS);
        reconnectTimer.unref();
      }
    }
  }

  const sync = setInterval(async () => {
    if (!database) return;
    try {
      if ((await database.version()) !== databaseVersion) await reloadSecrets();
      databaseError = null;
    } catch (error) {
      databaseError = describeConnectionError(error);
    }
  }, SYNC_MS);
  sync.unref();

  works = compileWorks(store.works());

  // --- the gateway ---------------------------------------------------------------

  const gateway = createGateway({
    getWorks: () => works,
    getSecret: (id) => secrets.get(id),
    log,
  });

  // A mistake in handling one request must not take the others down with it.
  const guarded = (handler) => (req, res) => {
    try {
      handler(req, res);
    } catch (error) {
      report(error);
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ message: 'the gateway failed on this request', reason: 'gateway' }));
      }
    }
  };

  // Usually one; two when the gateway is for this computer only, which takes
  // a listener for each of the two ways "localhost" can be spelt.
  let gatewayServers = [];
  let gatewayError = null;

  function gatewayServer() {
    const server = http.createServer(guarded(gateway.handle));
    // Uploads and long answers take as long as they take; the works' own
    // timeouts decide when a destination has been waited for long enough.
    server.requestTimeout = 0;
    server.on('clientError', (_error, socket) => socket.destroy());
    return server;
  }

  // A computer may have IPv6 switched off altogether; that is not a failure.
  const hasNoIpv6 = (error) => ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(error.code);

  async function startGateway() {
    await Promise.all(gatewayServers.map(close));
    gatewayServers = [];
    gatewayError = null;

    const { port } = settings.gateway;
    // "localhost" means ::1 before it means 127.0.0.1 on most computers, so
    // the gateway answers on both kinds of address: "::" takes IPv4 callers
    // too, and "this computer only" is spelt out twice.
    const attempts = settings.gateway.public
      ? [{ host: '::', orElse: '0.0.0.0' }]
      : [{ host: '127.0.0.1' }, { host: '::1', optional: true }];

    try {
      for (const { host, orElse, optional } of attempts) {
        const server = gatewayServer();
        try {
          await listen(server, port, host);
        } catch (error) {
          if (!hasNoIpv6(error)) throw error;
          if (optional) continue;
          await listen(server, port, orElse);
        }
        gatewayServers.push(server);
      }
    } catch (error) {
      await Promise.all(gatewayServers.map(close));
      gatewayServers = [];
      gatewayError =
        error.code === 'EADDRINUSE'
          ? { reason: 'port_in_use', message: `port ${port} is used by another program` }
          : error.code === 'EACCES'
            ? { reason: 'port_not_allowed', message: `this computer does not let the app use port ${port}` }
            : { reason: 'failed', message: error.message };
    }
  }

  // --- what the API is given -----------------------------------------------------

  const engine = {
    uiDir,
    devOrigins,
    log,
    sessions,
    store,
    secretsStore,
    report,
    reload,
    quit,
    gateway: guarded(gateway.handle),

    status: () => ({
      version,
      buildDate,
      // Whether this is the desktop app, with a window to close, or the gateway on its own.
      hasWindow,
      gateway: {
        port: settings.gateway.port,
        public: settings.gateway.public,
        running: gatewayServers.length > 0,
        error: gatewayError,
      },
      app: { port: appPort },
      addresses: localAddresses(),
      // Where the projects are kept, for whoever wants to back the file up.
      dataFile: store.file,
      // The shared database the secrets come from; not `used` means they are in the data file.
      database: {
        used: usesDatabase(),
        connected: Boolean(database) && !databaseError,
        error: databaseError,
        host: settings.database.host,
        port: settings.database.port,
        name: settings.database.database,
        user: settings.database.user,
      },
      // Changes whenever a project, a work or (anywhere) a secret does.
      revision: `${store.revision()}:${databaseVersion ?? '-'}`,
    }),

    // Everything but the database's password, which only ever goes in.
    shownSettings: () => ({
      gateway: settings.gateway,
      window: settings.window,
      database: { ...settings.database, password: undefined, hasPassword: settings.database.password !== '' },
    }),

    /** A password left out means "the one already saved". */
    async testDatabase(given) {
      const tried = normalized({
        database: { ...given, password: given.password ?? settings.database.password },
      }).database;
      if (!tried.host) return { ok: false, error: { reason: 'no_host', message: 'Enter the server\'s address.' } };

      try {
        await tryConnection(tried);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: describeConnectionError(error) };
      }
    },

    /** `database: null` goes back to keeping the secrets in this computer's file. */
    async applySettings(given) {
      const nextDatabase =
        given.database === null
          ? { ...settings.database, host: '', password: '' }
          : { ...settings.database, ...given.database, password: given.database?.password ?? settings.database.password };
      const next = normalized({
        gateway: { ...settings.gateway, ...given.gateway },
        app: settings.app,
        window: { ...settings.window, ...given.window },
        database: nextDatabase,
      });

      const gatewayChanged = JSON.stringify(next.gateway) !== JSON.stringify(settings.gateway);
      const databaseChanged = JSON.stringify(next.database) !== JSON.stringify(settings.database);

      settings = next;
      settingsStore.save(settings);

      if (gatewayChanged || gatewayServers.length === 0) await startGateway();
      if (databaseChanged || (usesDatabase() && !database)) {
        // A session opened with one place's password says nothing about the other's.
        if (databaseChanged) sessions.end();
        await connectDatabase();
      }
    },
  };

  // --- the app's own address -----------------------------------------------------

  const appServer = http.createServer(guarded(createApi(engine)));
  appServer.on('clientError', (_error, socket) => socket.destroy());

  // The port the app prefers may be taken, by a second copy of the app if
  // nothing else; whoever needs it is told where to go, so any free one will do.
  let appPort = settings.app.port;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await listen(appServer, appPort, '127.0.0.1');
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || attempt >= 20) throw error;
      appPort += 1;
    }
  }
  const url = `http://127.0.0.1:${appPort}`;

  await startGateway();
  // Not waited for long: the window opens at once and shows how the connection is going.
  await Promise.race([connectDatabase().catch(report), new Promise((resolve) => setTimeout(resolve, 1500))]);

  // For the command line: where this engine is, for as long as it runs.
  const runningFile = path.join(path.dirname(dataFile), RUNNING_FILE);
  try {
    writeFileSync(runningFile, `${JSON.stringify({ url, pid: process.pid })}\n`);
  } catch (error) {
    report(error);
  }

  return {
    url,
    status: engine.status,
    /** What the window's close button is set to do: "ask", "tray" or "quit". */
    onClose: () => settings.window.onClose,
    rememberOnClose: (onClose) => engine.applySettings({ window: { onClose } }),

    async stop() {
      stopped = true;
      clearInterval(sync);
      clearTimeout(reconnectTimer);
      rmSync(runningFile, { force: true });
      gateway.stop();
      await close(appServer);
      await Promise.all(gatewayServers.map(close));
      if (database) await database.close();
    },
  };
}
