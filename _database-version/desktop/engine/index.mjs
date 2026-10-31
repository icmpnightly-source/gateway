// Puts the engine together: the settings of this computer, the shared
// database, the gateway that clients call and the API the app's window uses.
//
// Nothing here needs Electron: `node engine/cli.mjs` runs the same engine
// without a window.

import http from 'node:http';
import os from 'node:os';
import { createApi } from './api.mjs';
import { Refusal, describeConnectionError, openDatabase, tryConnection } from './db.mjs';
import { compileWorks, createGateway } from './gateway.mjs';
import { keyOf } from './jwt.mjs';
import { createRequestsLog } from './requests-log.mjs';
import { createSessions } from './sessions.mjs';
import { createSettingsStore, normalized } from './settings.mjs';

// How often the database is asked whether another computer changed something.
const SYNC_MS = 2000;
// How long before trying again to reach a database that did not answer.
const RECONNECT_MS = 5000;

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
 * - `settingsFile`: where this computer's settings are kept.
 * - `uiDir`: the built UI's files.
 * - `vault`: `{ seal, open }` for the database password at rest.
 * - `devOrigins`: extra origins the API accepts calls from (the dev server's).
 */
export async function startEngine({ settingsFile, uiDir, vault, devOrigins = [], version = '', report = console.error }) {
  const store = createSettingsStore(settingsFile, vault);
  let settings = store.load();

  const log = createRequestsLog();
  const sessions = createSessions();

  // --- the shared configuration, as last read ----------------------------------

  let db = null;
  let dbError = null;
  let works = [];
  let secrets = new Map();
  let seenVersion = null;
  let reconnectTimer = null;
  let stopped = false;

  async function reload() {
    if (!db) return;

    const [allWorks, keys, version_] = await Promise.all([db.works(), db.secretKeys(), db.version()]);
    works = compileWorks(allWorks);
    secrets = new Map(keys.map((secret) => [secret.id, { name: secret.name, algorithm: secret.algorithm, key: keyOf(secret) }]));
    seenVersion = version_;
  }

  async function connect() {
    clearTimeout(reconnectTimer);
    if (db) await db.close();
    db = null;

    if (!settings.database.host) {
      dbError = null;
      return;
    }

    try {
      const opened = await openDatabase(settings.database);
      if (stopped) return void opened.close();
      db = opened;
      await reload();
      dbError = null;
    } catch (error) {
      dbError = describeConnectionError(error);
      // The gateway goes on with what it last read; the app keeps trying.
      if (!db && !stopped) {
        reconnectTimer = setTimeout(() => connect().catch(report), RECONNECT_MS);
        reconnectTimer.unref();
      }
    }
  }

  const sync = setInterval(async () => {
    if (!db) return;
    try {
      if ((await db.version()) !== seenVersion) await reload();
      dbError = null;
    } catch (error) {
      dbError = describeConnectionError(error);
    }
  }, SYNC_MS);
  sync.unref();

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
          : { reason: 'failed', message: error.message };
    }
  }

  // --- what the API is given -----------------------------------------------------

  const engine = {
    uiDir,
    devOrigins,
    log,
    sessions,
    report,
    reload,
    gateway: guarded(gateway.handle),

    database() {
      if (!db) {
        throw new Refusal(503, dbError?.message ?? 'the database is not set up yet', {
          reason: dbError?.reason ?? 'not_configured',
        });
      }
      return db;
    },

    status: () => ({
      version,
      configured: Boolean(settings.database.host),
      database: {
        connected: Boolean(db) && !dbError,
        error: dbError,
        host: settings.database.host,
        port: settings.database.port,
        name: settings.database.database,
        user: settings.database.user,
      },
      gateway: {
        port: settings.gateway.port,
        public: settings.gateway.public,
        running: gatewayServers.length > 0,
        error: gatewayError,
      },
      app: { port: appPort },
      addresses: localAddresses(),
      revision: seenVersion,
    }),

    // Everything but the password, which only ever goes in.
    shownSettings: () => ({
      database: { ...settings.database, password: undefined, hasPassword: settings.database.password !== '' },
      gateway: settings.gateway,
    }),

    /** A password left out means "the one already saved". */
    async testDatabase(given) {
      const database = normalized({
        database: { ...given, password: given.password ?? settings.database.password },
      }).database;
      if (!database.host) return { ok: false, error: { reason: 'no_host', message: 'Enter the server\'s address.' } };

      try {
        await tryConnection(database);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: describeConnectionError(error) };
      }
    },

    async applySettings(given) {
      const next = normalized({
        database: { ...settings.database, ...given.database, password: given.database?.password ?? settings.database.password },
        gateway: { ...settings.gateway, ...given.gateway },
        app: settings.app,
      });

      const databaseChanged = JSON.stringify(next.database) !== JSON.stringify(settings.database);
      const gatewayChanged = JSON.stringify(next.gateway) !== JSON.stringify(settings.gateway);

      settings = next;
      store.save(settings);

      if (databaseChanged || !db) await connect();
      if (gatewayChanged || gatewayServers.length === 0) await startGateway();
    },
  };

  // --- the app's own address -----------------------------------------------------

  const appServer = http.createServer(guarded(createApi(engine)));
  appServer.on('clientError', (_error, socket) => socket.destroy());

  // The port the app prefers may be taken, by a second copy of the app if
  // nothing else; the window is told where to go, so any free one will do.
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

  await startGateway();
  // Not waited for: the window opens at once and shows how the connection is going.
  connect().catch(report);

  return {
    url: `http://127.0.0.1:${appPort}`,
    status: engine.status,

    async stop() {
      stopped = true;
      clearInterval(sync);
      clearTimeout(reconnectTimer);
      gateway.stop();
      await close(appServer);
      await Promise.all(gatewayServers.map(close));
      if (db) await db.close();
    },
  };
}
