// The one thing computers may share: a PostgreSQL database holding the JWT
// secrets and the administrator's password. The administrator enters a secret
// once; every computer connected to the database verifies tokens with it and
// offers it, by name, to its works.
//
// Projects and works are not in it: those stay in each computer's own file.

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Refusal } from './store.mjs';

// Each statement is safe to run again: every app that connects makes sure the
// tables are there.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kg_secrets (
     id uuid PRIMARY KEY,
     name text NOT NULL UNIQUE,
     algorithm text NOT NULL,
     value text,
     value_is_base64 boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // A secret may wait for its value: one named by an imported project.
  `ALTER TABLE kg_secrets ALTER COLUMN value DROP NOT NULL`,
  `CREATE TABLE IF NOT EXISTS kg_settings (
     key text PRIMARY KEY,
     value jsonb NOT NULL
   )`,
  // Goes up by one with every change, which is how the other computers notice
  // there is something to read again.
  `INSERT INTO kg_settings (key, value) VALUES ('version', '0') ON CONFLICT (key) DO NOTHING`,
];

// Keeps two apps that connect at the same moment from creating the tables twice.
const SCHEMA_LOCK = 748211;

const UNIQUE_VIOLATION = '23505';

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
    max: 4,
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

// Everything about a secret except the secret.
const shown = (row) => ({
  id: row.id,
  name: row.name,
  algorithm: row.algorithm,
  hasValue: row.has_value,
  createdAt: row.created_at.toISOString(),
});

const SHOWN = 'id, name, algorithm, value IS NOT NULL AS has_value, created_at';

/** The same calls the local store answers for its own secrets (store.mjs), answered by the database. */
export async function openSecretsDatabase(config) {
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
  const taken = () => new Refusal(409, 'a secret with this name already exists');

  return {
    close: () => pool.end().catch(() => undefined),

    async version() {
      return Number(await setting('version'));
    },

    async secrets() {
      const { rows } = await pool.query(`SELECT ${SHOWN} FROM kg_secrets ORDER BY name`);
      return rows.map(shown);
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
             VALUES ($1, $2, $3, $4, $5) RETURNING ${SHOWN}`,
            [randomUUID(), name, algorithm, value, valueIsBase64],
          ),
        );
        return shown(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw taken();
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
                    value_is_base64 = CASE WHEN $4::text IS NULL THEN value_is_base64 ELSE $5 END,
                    updated_at = now()
              WHERE id = $1 RETURNING ${SHOWN}`,
            [id, name ?? null, algorithm ?? null, value ?? null, Boolean(valueIsBase64)],
          ),
        );
        if (!rows[0]) throw new Refusal(404, 'no such secret');
        return shown(rows[0]);
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) throw taken();
        throw error;
      }
    },

    async deleteSecret(id) {
      const { rowCount } = await change((client) => client.query('DELETE FROM kg_secrets WHERE id = $1', [id]));
      if (!rowCount) throw new Refusal(404, 'no such secret');
    },

    /**
     * Secrets an imported project names that are not here yet, added without
     * a value for the administrator to fill in. Returns the id each name goes
     * by: somebody else may have added the same name a moment ago.
     */
    async addPlaceholders(placeholders) {
      return change(async (client) => {
        const ids = new Map();
        for (const { id, name, algorithm } of placeholders) {
          await client.query(
            `INSERT INTO kg_secrets (id, name, algorithm, value) VALUES ($1, $2, $3, NULL) ON CONFLICT (name) DO NOTHING`,
            [id, name, algorithm],
          );
          const { rows } = await client.query('SELECT id FROM kg_secrets WHERE name = $1', [name]);
          ids.set(name, rows[0].id);
        }
        return ids;
      });
    },

    adminPassword: async () => (await setting('admin_password')) ?? null,

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
