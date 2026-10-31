// The one thing every computer shares: a PostgreSQL database holding the
// projects, their works, the JWT secrets and the administrator's password.

import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Each statement is safe to run again: every app that starts makes sure the
// tables are there.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kg_projects (
     id uuid PRIMARY KEY,
     name text NOT NULL UNIQUE,
     token_fields jsonb NOT NULL DEFAULT '[]',
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS kg_works (
     id uuid PRIMARY KEY,
     project_id uuid NOT NULL REFERENCES kg_projects (id) ON DELETE CASCADE,
     name text NOT NULL,
     config jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (project_id, name)
   )`,
  `CREATE TABLE IF NOT EXISTS kg_secrets (
     id uuid PRIMARY KEY,
     name text NOT NULL UNIQUE,
     algorithm text NOT NULL,
     value text NOT NULL,
     value_is_base64 boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS kg_settings (
     key text PRIMARY KEY,
     value jsonb NOT NULL
   )`,
  // Goes up by one with every change, which is how the other computers'
  // gateways notice there is something to reload.
  `INSERT INTO kg_settings (key, value) VALUES ('version', '0') ON CONFLICT (key) DO NOTHING`,
];

// Keeps two apps that start at the same moment from creating the tables twice.
const SCHEMA_LOCK = 748211;

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/** A failure the caller is expected to explain to the user, with the HTTP status that fits. */
export class Refusal extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** What went wrong reaching the database, in words a person can act on. */
export function describeConnectionError(error) {
  const text = String(error?.message ?? error);

  switch (error?.code) {
    case 'ECONNREFUSED':
      return { reason: 'refused', message: 'The server refused the connection: is PostgreSQL running, and is the port right?' };
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return { reason: 'unreachable', message: 'No answer from the server: check its address and that its firewall lets this port in.' };
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { reason: 'unknown_host', message: 'The server name could not be found.' };
    case '28P01':
    case '28000':
      return { reason: 'credentials', message: 'The user name or password is not accepted.' };
    case '3D000':
      return { reason: 'no_database', message: 'There is no database with this name on the server.' };
    case '42501':
      return { reason: 'no_rights', message: 'This user may not create tables in the database.' };
    default:
      if (/timeout/i.test(text)) {
        return { reason: 'unreachable', message: 'No answer from the server: check its address and that its firewall lets this port in.' };
      }
      if (/pg_hba\.conf/i.test(text)) {
        return { reason: 'not_allowed', message: 'The server does not accept connections from this computer (pg_hba.conf).' };
      }
      if (/SSL|TLS/i.test(text)) {
        return { reason: 'ssl', message: `Encrypted connection failed: ${text}` };
      }
      return { reason: 'other', message: text };
  }
}

function poolFor(config) {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    // Encrypted, without insisting on a certificate some authority signed:
    // inside a company network it is usually the server's own.
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

  // A connection dropped while idle is replaced on the next query; without a
  // listener it would take the whole app down.
  pool.on('error', () => undefined);
  return pool;
}

async function prepare(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
    for (const statement of SCHEMA) await client.query(statement);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Connects just to see whether it works; leaves nothing open. */
export async function tryConnection(config) {
  const pool = poolFor(config);
  try {
    await prepare(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const toProject = (row) => ({
  id: row.id,
  name: row.name,
  tokenFields: row.token_fields ?? [],
  createdAt: row.created_at.toISOString(),
});

const toWork = (row) => ({
  ...row.config,
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  createdAt: row.created_at.toISOString(),
});

// Everything about a secret except the secret.
const toPublicSecret = (row) => ({
  id: row.id,
  name: row.name,
  algorithm: row.algorithm,
  createdAt: row.created_at.toISOString(),
});

export async function openDatabase(config) {
  const pool = poolFor(config);
  try {
    await prepare(pool);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }

  // One change, whole or not at all, and the version goes up with it.
  async function change(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query(
        `UPDATE kg_settings SET value = to_jsonb((value #>> '{}')::bigint + 1) WHERE key = 'version'`,
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const setting = async (key) => (await pool.query('SELECT value FROM kg_settings WHERE key = $1', [key])).rows[0]?.value;

  return {
    close: () => pool.end().catch(() => undefined),

    async version() {
      return Number(await setting('version'));
    },

    // --- projects -----------------------------------------------------------

    async projects() {
      const { rows } = await pool.query('SELECT * FROM kg_projects ORDER BY created_at, name');
      return rows.map(toProject);
    },

    async createProject(name) {
      try {
        const { rows } = await change((client) =>
          client.query('INSERT INTO kg_projects (id, name) VALUES ($1, $2) RETURNING *', [randomUUID(), name]),
        );
        return toProject(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw new Refusal(409, 'a project with this name already exists');
        throw error;
      }
    },

    async updateProject(id, { name, tokenFields }) {
      try {
        const { rows } = await change((client) =>
          client.query(
            `UPDATE kg_projects
                SET name = COALESCE($2, name), token_fields = COALESCE($3::jsonb, token_fields)
              WHERE id = $1 RETURNING *`,
            [id, name ?? null, tokenFields === undefined ? null : JSON.stringify(tokenFields)],
          ),
        );
        if (!rows[0]) throw new Refusal(404, 'no such project');
        return toProject(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw new Refusal(409, 'a project with this name already exists');
        throw error;
      }
    },

    /** The project and, with it, its works. */
    async deleteProject(id) {
      const { rowCount } = await change((client) => client.query('DELETE FROM kg_projects WHERE id = $1', [id]));
      if (!rowCount) throw new Refusal(404, 'no such project');
    },

    // --- works --------------------------------------------------------------

    async works() {
      const { rows } = await pool.query('SELECT * FROM kg_works ORDER BY created_at, name');
      return rows.map(toWork);
    },

    async createWork(projectId, name, config) {
      try {
        const { rows } = await change((client) =>
          client.query(
            'INSERT INTO kg_works (id, project_id, name, config) VALUES ($1, $2, $3, $4::jsonb) RETURNING *',
            [randomUUID(), projectId, name, JSON.stringify(config)],
          ),
        );
        return toWork(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw new Refusal(409, 'the project already has a work with this name');
        if (error.code === FOREIGN_KEY_VIOLATION) throw new Refusal(404, 'no such project');
        throw error;
      }
    },

    async updateWork(id, name, config) {
      try {
        const { rows } = await change((client) =>
          client.query(
            'UPDATE kg_works SET name = $2, config = $3::jsonb, updated_at = now() WHERE id = $1 RETURNING *',
            [id, name, JSON.stringify(config)],
          ),
        );
        if (!rows[0]) throw new Refusal(404, 'no such work');
        return toWork(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw new Refusal(409, 'the project already has a work with this name');
        throw error;
      }
    },

    async deleteWork(id) {
      const { rowCount } = await change((client) => client.query('DELETE FROM kg_works WHERE id = $1', [id]));
      if (!rowCount) throw new Refusal(404, 'no such work');
    },

    // --- secrets ------------------------------------------------------------

    async secrets() {
      const { rows } = await pool.query('SELECT id, name, algorithm, created_at FROM kg_secrets ORDER BY name');
      return rows.map(toPublicSecret);
    },

    /** With their values: for the gateway alone, never for the app's window. */
    async secretKeys() {
      const { rows } = await pool.query('SELECT id, name, algorithm, value, value_is_base64 FROM kg_secrets');
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        algorithm: row.algorithm,
        value: row.value,
        valueIsBase64: row.value_is_base64,
      }));
    },

    async createSecret({ name, algorithm, value, valueIsBase64 }) {
      try {
        const { rows } = await change((client) =>
          client.query(
            `INSERT INTO kg_secrets (id, name, algorithm, value, value_is_base64)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, name, algorithm, created_at`,
            [randomUUID(), name, algorithm, value, valueIsBase64],
          ),
        );
        return toPublicSecret(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw new Refusal(409, 'a secret with this name already exists');
        throw error;
      }
    },

    /** Whatever is left out keeps what it holds: a secret is renamed without anyone knowing its value. */
    async updateSecret(id, { name, algorithm, value, valueIsBase64 }) {
      try {
        const { rows } = await change((client) =>
          client.query(
            `UPDATE kg_secrets
                SET name = COALESCE($2, name),
                    algorithm = COALESCE($3, algorithm),
                    value = COALESCE($4, value),
                    value_is_base64 = COALESCE($5, value_is_base64),
                    updated_at = now()
              WHERE id = $1 RETURNING id, name, algorithm, created_at`,
            [id, name ?? null, algorithm ?? null, value ?? null, valueIsBase64 ?? null],
          ),
        );
        if (!rows[0]) throw new Refusal(404, 'no such secret');
        return toPublicSecret(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw new Refusal(409, 'a secret with this name already exists');
        throw error;
      }
    },

    /** Refused while a work verifies tokens against it. */
    async deleteSecret(id) {
      await change(async (client) => {
        const { rows } = await client.query(
          `SELECT count(*)::int AS in_use FROM kg_works
            WHERE config #>> '{token,verify,secretId}' = $1
              AND (config #>> '{token,verify,enabled}')::boolean
              AND (config #>> '{token,enabled}')::boolean`,
          [id],
        );
        const inUse = rows[0].in_use;
        if (inUse > 0) throw new Refusal(409, `the secret is used by ${inUse} work(s)`, { in_use: inUse });

        const { rowCount } = await client.query('DELETE FROM kg_secrets WHERE id = $1', [id]);
        if (!rowCount) throw new Refusal(404, 'no such secret');
      });
    },

    // --- the administrator's password ---------------------------------------

    adminPassword: () => setting('admin_password'),

    /** Sets the password only if `expected` is still what the database holds (null: none yet). */
    async setAdminPassword(record, expected) {
      return change(async (client) => {
        const { rows } = await client.query(`SELECT value FROM kg_settings WHERE key = 'admin_password' FOR UPDATE`);
        const current = rows[0]?.value ?? null;
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;

        await client.query(
          `INSERT INTO kg_settings (key, value) VALUES ('admin_password', $1::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [JSON.stringify(record)],
        );
        return true;
      });
    },
  };
}
