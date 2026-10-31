// What the app keeps in a JSON file on this computer: the projects and their
// works, always; and the JWT secrets and the administrator's password, unless
// those are in a shared database instead (secrets-db.mjs answers the same
// calls for them).
//
// Projects are never shared: one travels to another computer as an exported
// JSON file, which never holds a secret's value.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { PLAIN_VAULT, writeWhole } from './settings.mjs';

/** What the data file and an exported project are marked with. */
const FORMAT = 1;

/** A failure the caller is expected to explain to the user, with the HTTP status that fits. */
export class Refusal extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const EMPTY = { format: FORMAT, projects: [], works: [], secrets: [], adminPassword: null };

const copy = (value) => structuredClone(value);
const now = () => new Date().toISOString();

// Everything about a secret except the secret.
const shown = (secret) => ({
  id: secret.id,
  name: secret.name,
  algorithm: secret.algorithm,
  // False for a secret a project was imported with: its name came along, its
  // value has to be entered here.
  hasValue: secret.value !== null,
  createdAt: secret.createdAt,
});

const usesSecret = (work, id) => work.token.enabled && work.token.verify.enabled && work.token.verify.secretId === id;

/**
 * `vault` (`{ seal, open }`) is what secrets' values are kept in the file
 * with; without one they are only kept out of plain sight.
 */
export function openStore(file, vault = PLAIN_VAULT) {
  let data = copy(EMPTY);
  // Goes up with every change: how the screens notice there is something new.
  let revision = 1;

  if (existsSync(file)) {
    try {
      const read = JSON.parse(readFileSync(file, 'utf8'));
      data = {
        format: FORMAT,
        projects: Array.isArray(read.projects) ? read.projects : [],
        works: Array.isArray(read.works) ? read.works : [],
        secrets: Array.isArray(read.secrets) ? read.secrets : [],
        adminPassword: read.adminPassword ?? null,
      };
    } catch {
      // Unreadable: set aside rather than written over, in case it can be mended.
      renameSync(file, `${file}.broken-${Date.now()}`);
    }
  }

  function save() {
    revision += 1;
    writeWhole(file, `${JSON.stringify(data, null, 2)}\n`);
  }

  const seal = (value) => vault.seal(value);
  // A value sealed on another computer, or by another user, opens for nobody
  // here: the secret is then one whose value is yet to be entered.
  const open = (sealed) => {
    if (typeof sealed !== 'string') return null;
    try {
      return vault.open(sealed) ?? PLAIN_VAULT.open(sealed);
    } catch {
      return null;
    }
  };

  const projectById = (id) => data.projects.find((project) => project.id === id);
  const nameIsFree = (list, name, except) => !list.some((item) => item.name === name && item.id !== except);

  // "name", then "name (2)", "name (3)"… for a project imported under a name that is taken.
  function freeProjectName(name) {
    if (nameIsFree(data.projects, name)) return name;
    for (let count = 2; ; count += 1) {
      const candidate = `${name} (${count})`;
      if (nameIsFree(data.projects, candidate)) return candidate;
    }
  }

  return {
    file,
    revision: () => revision,

    // --- projects -----------------------------------------------------------

    projects: () => copy(data.projects),

    createProject(name) {
      if (!nameIsFree(data.projects, name)) throw new Refusal(409, 'a project with this name already exists');

      const project = { id: randomUUID(), name, tokenFields: [], createdAt: now() };
      data.projects.push(project);
      save();
      return copy(project);
    },

    updateProject(id, { name, tokenFields }) {
      const project = projectById(id);
      if (!project) throw new Refusal(404, 'no such project');
      if (name !== undefined && !nameIsFree(data.projects, name, id)) {
        throw new Refusal(409, 'a project with this name already exists');
      }

      if (name !== undefined) project.name = name;
      if (tokenFields !== undefined) project.tokenFields = tokenFields;
      save();
      return copy(project);
    },

    /** The project and, with it, its works. */
    deleteProject(id) {
      if (!projectById(id)) throw new Refusal(404, 'no such project');

      data.projects = data.projects.filter((project) => project.id !== id);
      data.works = data.works.filter((work) => work.projectId !== id);
      save();
    },

    // --- works --------------------------------------------------------------

    works: () => copy(data.works),

    createWork(projectId, name, config) {
      if (!projectById(projectId)) throw new Refusal(404, 'no such project');
      if (!nameIsFree(data.works.filter((work) => work.projectId === projectId), name)) {
        throw new Refusal(409, 'the project already has a work with this name');
      }

      const work = { ...config, id: randomUUID(), projectId, name, createdAt: now() };
      data.works.push(work);
      save();
      return copy(work);
    },

    updateWork(id, name, config) {
      const index = data.works.findIndex((work) => work.id === id);
      if (index === -1) throw new Refusal(404, 'no such work');

      const { projectId, createdAt } = data.works[index];
      if (!nameIsFree(data.works.filter((work) => work.projectId === projectId), name, id)) {
        throw new Refusal(409, 'the project already has a work with this name');
      }

      data.works[index] = { ...config, id, projectId, name, createdAt };
      save();
      return copy(data.works[index]);
    },

    deleteWork(id) {
      if (!data.works.some((work) => work.id === id)) throw new Refusal(404, 'no such work');

      data.works = data.works.filter((work) => work.id !== id);
      save();
    },

    /** How many of this computer's works verify tokens against the secret. */
    worksUsing: (secretId) => data.works.filter((work) => usesSecret(work, secretId)).length,

    // --- secrets ------------------------------------------------------------

    secrets: () => data.secrets.map(shown).sort((a, b) => a.name.localeCompare(b.name)),

    /** With their values: for the gateway alone, never for the app's window. */
    secretKeys: () =>
      data.secrets.map((secret) => ({
        id: secret.id,
        name: secret.name,
        algorithm: secret.algorithm,
        value: open(secret.value),
        valueIsBase64: secret.valueIsBase64,
      })),

    createSecret({ name, algorithm, value, valueIsBase64 }) {
      if (!nameIsFree(data.secrets, name)) throw new Refusal(409, 'a secret with this name already exists');

      const secret = { id: randomUUID(), name, algorithm, value: seal(value), valueIsBase64, createdAt: now() };
      data.secrets.push(secret);
      save();
      return shown(secret);
    },

    /** Whatever is left out keeps what it holds: a secret is renamed without anyone knowing its value. */
    updateSecret(id, { name, algorithm, value, valueIsBase64 }) {
      const secret = data.secrets.find((candidate) => candidate.id === id);
      if (!secret) throw new Refusal(404, 'no such secret');
      if (name !== undefined && !nameIsFree(data.secrets, name, id)) {
        throw new Refusal(409, 'a secret with this name already exists');
      }

      if (name !== undefined) secret.name = name;
      if (algorithm !== undefined) secret.algorithm = algorithm;
      if (value !== undefined) {
        secret.value = seal(value);
        secret.valueIsBase64 = Boolean(valueIsBase64);
      }
      save();
      return shown(secret);
    },

    deleteSecret(id) {
      if (!data.secrets.some((secret) => secret.id === id)) throw new Refusal(404, 'no such secret');

      data.secrets = data.secrets.filter((secret) => secret.id !== id);
      save();
    },

    /**
     * Secrets an imported project names that are not here yet, added without
     * a value for the administrator to fill in. Returns the id each name goes by.
     */
    addPlaceholders(placeholders) {
      const ids = new Map();
      for (const { id, name, algorithm } of placeholders) {
        const existing = data.secrets.find((secret) => secret.name === name);
        if (!existing) data.secrets.push({ id, name, algorithm, value: null, valueIsBase64: false, createdAt: now() });
        ids.set(name, existing?.id ?? id);
      }
      save();
      return ids;
    },

    // --- the administrator's password ---------------------------------------

    adminPassword: () => copy(data.adminPassword),

    /** Always takes: nobody else writes this file. (The shared database may refuse; see there.) */
    setAdminPassword(record) {
      data.adminPassword = record;
      save();
      return true;
    },

    // --- a project as a file ------------------------------------------------

    /**
     * A project with its works, for another computer to import. Secrets go by
     * name and algorithm only (`secrets` is the list they are looked up in):
     * their values stay where they are.
     */
    exportProject(id, secrets) {
      const project = projectById(id);
      if (!project) throw new Refusal(404, 'no such project');

      const used = new Map();
      const works = data.works
        .filter((work) => work.projectId === id)
        .map(({ id: _id, projectId: _projectId, createdAt: _createdAt, ...work }) => {
          const { secretId, ...verify } = work.token.verify;
          const secret = secrets.find((candidate) => candidate.id === secretId);
          if (secret) used.set(secret.id, { name: secret.name, algorithm: secret.algorithm });

          return { ...work, token: { ...work.token, verify: { ...verify, secret: secret?.name ?? '' } } };
        });

      return copy({
        konggate: FORMAT,
        exportedAt: now(),
        project: { name: project.name, tokenFields: project.tokenFields },
        works,
        secrets: [...used.values()],
      });
    },

    /** A whole project at once, already checked by the caller. */
    importProject({ name, tokenFields, works }) {
      const project = { id: randomUUID(), name: freeProjectName(name), tokenFields, createdAt: now() };
      data.projects.push(project);
      for (const { name: workName, config } of works) {
        data.works.push({ ...config, id: randomUUID(), projectId: project.id, name: workName, createdAt: now() });
      }
      save();
      return copy(project);
    },
  };
}
