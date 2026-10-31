#!/usr/bin/env node
// konggate: the app from the command line.
//
// Every command but "serve" talks to a KongGate that is already running on
// this computer, the desktop app or one started with "serve", through the
// same API the app's window uses. So there is one program holding the data,
// whichever way it is told what to do.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));

const HELP = `KongGate ${version}

Usage: konggate <command> [options]

  serve                            run the gateway here, without a window
  stop                             stop the KongGate that is running (app or serve): its ports are freed
  status                           how the gateway and the secrets database are doing

  projects                         list the projects
  works [project]                  list the works (of one project)
  export <project> [file]          save a project and its works as a JSON file
  import <file>                    add the project a JSON file holds

  secrets                          list the JWT secrets (names, never values)
  secrets add <name>               add a secret, or give one its missing value   (administrator)
      --algorithm HS256            HS256/384/512, RS…, ES…, PS…, EdDSA (default HS256)
      --value-file <file>          read the value from a file (else it is asked for)
      --base64                     the value is base64
      --replace                    replace the value of a secret that has one
  secrets remove <name>            delete a secret                                (administrator)
  password                         set or change the administrator's password

  port [number] [--local|--public] show or change the gateway's port, and who may call it
  database                         show where the secrets are kept
  database set --host <address> [--port 5432] [--name konggate] [--user konggate] [--ssl]
                                   keep the secrets in a shared PostgreSQL database
  database off                     keep the secrets in this computer's file again
  log [--failed] [--limit 20]      the latest recorded requests

Anywhere:
  --data <folder>   the app's folder (default: ${defaultDataFolder()})
  --json            print what the app answered as JSON

Passwords and secret values are asked for without being shown. For scripts,
they are read from KONGGATE_ADMIN_PASSWORD, KONGGATE_DB_PASSWORD and
KONGGATE_SECRET_VALUE instead.`;

// --- what was typed ------------------------------------------------------------

const FLAGS_WITHOUT_VALUE = new Set(['local', 'public', 'ssl', 'base64', 'replace', 'failed', 'json', 'help']);

function parse(argv) {
  const words = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }

    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (inline !== undefined) options[name] = inline;
    else if (FLAGS_WITHOUT_VALUE.has(name)) options[name] = true;
    else options[name] = argv[(index += 1)];
  }
  return { words, options };
}

const { words, options } = parse(process.argv.slice(2));

class Failure extends Error {}
const fail = (message) => {
  throw new Failure(message);
};

// --- where the app is ------------------------------------------------------------

// The same folder the desktop app keeps its files in.
function defaultDataFolder() {
  if (process.env.KONGGATE_DATA) return process.env.KONGGATE_DATA;
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'KongGate');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'KongGate');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'KongGate');
}

const dataFolder = path.resolve(options.data ?? defaultDataFolder());

/** The address of the KongGate running from the data folder, if one is. */
async function running() {
  try {
    const { url } = JSON.parse(readFileSync(path.join(dataFolder, 'running.json'), 'utf8'));
    const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(3000) });
    return response.ok ? url : undefined;
  } catch {
    // No such file, or a file left by a KongGate that is gone.
    return undefined;
  }
}

let appUrl;

async function call(method, url, body, headers = {}) {
  appUrl ??= (await running()) ?? fail('KongGate is not running. Open the app, or start the gateway here with: konggate serve');

  const response = await fetch(`${appUrl}/api${url}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const answer = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Failure(answer?.message ?? `the app answered ${response.status}`);
    error.status = response.status;
    error.reason = answer?.reason;
    throw error;
  }
  return answer;
}

// --- asking and telling -----------------------------------------------------------

const say = (line = '') => console.log(line);

/** Rows as columns, each as wide as its longest cell. */
function table(headings, rows) {
  if (rows.length === 0) return;
  const cells = [headings, ...rows].map((row) => row.map((cell) => String(cell ?? '')));
  const widths = headings.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  for (const row of cells) say(row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd());
}

/** What was typed after a question; with `hidden`, without it showing on the screen. */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Shows the question and then nothing of what is typed.
      prompt._writeToOutput = (written) => {
        if (written.includes(question)) process.stdout.write(question);
      };
    }
    prompt.question(question, (answer) => {
      prompt.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** Something that must not be shown: from the environment for scripts, typed blind otherwise. */
async function confidential(label, variable) {
  if (process.env[variable]) return process.env[variable];
  if (!process.stdin.isTTY) fail(`${label}: nobody is there to ask; set ${variable}`);
  return ask(`${label}: `, { hidden: true });
}

async function everythingPiped() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** The header an administrator's calls carry; signs in first, setting the password if there is none yet. */
async function asAdministrator() {
  const { passwordSet } = await call('GET', '/admin');

  let password;
  if (passwordSet) {
    password = await confidential('Administrator password', 'KONGGATE_ADMIN_PASSWORD');
  } else {
    say('There is no administrator password yet: the one given now becomes it.');
    password = await confidential('New administrator password', 'KONGGATE_ADMIN_PASSWORD');
    await call('POST', '/admin/password', { password });
  }

  const { token } = await call('POST', '/login', { password });
  return { Authorization: `Bearer ${token}` };
}

async function projectNamed(name) {
  const projects = await call('GET', '/projects');
  const wanted = name.toLowerCase();
  const found =
    projects.find((project) => project.name === name) ??
    projects.filter((project) => project.name.toLowerCase() === wanted || project.id === name);
  const project = Array.isArray(found) ? (found.length === 1 ? found[0] : undefined) : found;
  return project ?? fail(`no project called "${name}" (see: konggate projects)`);
}

const fileName = (name) => name.replace(/[\\/:*?"<>|]+/g, '-');

// --- the commands ------------------------------------------------------------------

// Set by "serve": what ends its wait when the running gateway is told to stop.
let stopAsked = () => undefined;

const commands = {
  async serve() {
    if (await running()) fail('KongGate is already running from this folder; only one can.');

    const { startEngine } = await import('./engine/index.mjs');
    const engine = await startEngine({
      settingsFile: path.join(dataFolder, 'settings.json'),
      dataFile: path.join(dataFolder, 'data.json'),
      // The built screens: the frontend's own build in a checkout (where a copy
      // from the last packaging may be lying about too), the app's own otherwise.
      uiDir: [path.join(here, '..', 'frontend', 'dist'), path.join(here, 'ui')].find(existsSync),
      devOrigins: [options['dev-origin'], ...(process.env.KONGGATE_DEV_ORIGIN ?? '').split(',')].filter(Boolean),
      version,
      quit: () => stopAsked(),
    });

    const { gateway, database } = engine.status();
    say(`gateway   ${gateway.running ? `port ${gateway.port}${gateway.public ? '' : ' (this computer only)'}` : `NOT RUNNING: ${gateway.error?.message}`}`);
    say(`secrets   ${database.used ? `database ${database.host}:${database.port}/${database.name}${database.connected ? '' : ` (not connected: ${database.error?.message ?? 'still trying'})`}` : 'this computer\'s file'}`);
    say(`data      ${dataFolder}`);
    say(`screens   ${engine.url}`);
    say('\nCtrl+C stops it.');

    await new Promise((resolve) => {
      stopAsked = resolve;
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, resolve);
    });
    await engine.stop();
    // Nothing is left to wait for; an open connection must not keep the program.
    process.exit(0);
  },

  async stop() {
    const url = (await running()) ?? fail('KongGate is not running.');
    await call('POST', '/quit');

    // Said only once it is true: the program gone, its ports free.
    for (let waited = 0; waited < 10000; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const answers = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
      if (!answers) return say('KongGate has stopped; its ports are free.');
    }
    return fail('KongGate was asked to stop but is still answering.');
  },

  async status() {
    const status = await call('GET', '/status');
    if (options.json) return say(JSON.stringify(status, null, 2));

    const { gateway, database, addresses } = status;
    const [projects, works, secrets] = await Promise.all([
      call('GET', '/projects'),
      call('GET', '/works'),
      call('GET', '/secrets').catch(() => null),
    ]);
    const hosts = gateway.public ? addresses.filter((address) => !address.virtual).map((address) => address.address) : [];

    say(`KongGate ${status.version}`);
    say(`gateway   ${gateway.running ? [...hosts, 'localhost'].map((host) => `http://${host}:${gateway.port}`).join('  ') : `NOT RUNNING: ${gateway.error?.message}`}`);
    say(`secrets   ${database.used ? `database ${database.host}:${database.port}/${database.name} (${database.connected ? 'connected' : `not connected: ${database.error?.message ?? 'still trying'}`})` : 'this computer\'s file'}`);
    say(`data      ${status.dataFile}`);
    say(`holds     ${projects.length} project(s), ${works.length} work(s), ${secrets ? `${secrets.length} secret(s)` : 'secrets out of reach'}`);
  },

  async projects() {
    const [projects, works] = await Promise.all([call('GET', '/projects'), call('GET', '/works')]);
    if (options.json) return say(JSON.stringify(projects, null, 2));
    if (projects.length === 0) return say('No projects yet.');

    table(
      ['PROJECT', 'WORKS', 'CREATED'],
      projects.map((project) => [project.name, works.filter((work) => work.projectId === project.id).length, project.createdAt.slice(0, 10)]),
    );
  },

  async works(name) {
    const [projects, all, secrets] = await Promise.all([
      call('GET', '/projects'),
      call('GET', '/works'),
      call('GET', '/secrets').catch(() => []),
    ]);
    const project = name ? await projectNamed(name) : undefined;
    const works = all.filter((work) => !project || work.projectId === project.id);
    if (options.json) return say(JSON.stringify(works, null, 2));
    if (works.length === 0) return say('No works.');

    const projectName = (id) => projects.find((candidate) => candidate.id === id)?.name ?? '';
    const tokenOf = ({ token }) =>
      !token.enabled
        ? 'as it is'
        : token.verify.enabled
          ? `verified: ${secrets.find((secret) => secret.id === token.verify.secretId)?.name ?? '?'}`
          : 'read, not verified';
    table(
      ['PROJECT', 'WORK', 'METHODS', 'PATH', 'DESTINATION', 'TOKEN'],
      works.map((work) => [projectName(work.projectId), work.name, work.methods.join(',') || 'any', work.path, work.destination, tokenOf(work)]),
    );
  },

  async export(name, file) {
    if (!name) fail('which project? konggate export <project> [file]');
    const project = await projectNamed(name);
    const exported = await call('GET', `/projects/${project.id}/export`);

    const target = path.resolve(file ?? `${fileName(project.name)}.konggate.json`);
    writeFileSync(target, `${JSON.stringify(exported, null, 2)}\n`);
    say(`${project.name}: ${exported.works.length} work(s) written to ${target}`);
    if (exported.secrets.length > 0) {
      say(`Its secrets go by name only (${exported.secrets.map((secret) => secret.name).join(', ')}): whoever imports it needs them too.`);
    }
  },

  async import(file) {
    if (!file) fail('which file? konggate import <file>');
    let content;
    try {
      content = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
    } catch (error) {
      fail(`${file} cannot be read as JSON: ${error.message}`);
    }

    const result = await call('POST', '/projects/import', content);
    if (options.json) return say(JSON.stringify(result, null, 2));

    say(`Added the project "${result.project.name}" with ${result.works} work(s).`);
    if (result.missingSecrets.length > 0) {
      say('\nThese secrets are named by its works but have no value here yet. Until an');
      say('administrator enters them (konggate secrets add <name>), those works let no token through:');
      for (const secret of result.missingSecrets) say(`  ${secret.name} (${secret.algorithm})`);
    }
    if (result.clashes.length > 0) {
      say('\nThese paths are now answered by two works; change one of each pair:');
      for (const clash of result.clashes) say(`  ${clash.path}   ${clash.work}  <->  ${clash.with}`);
    }
  },

  async secrets(action, name) {
    if (!action) {
      const secrets = await call('GET', '/secrets');
      if (options.json) return say(JSON.stringify(secrets, null, 2));
      if (secrets.length === 0) return say('No secrets yet.');
      return table(
        ['SECRET', 'ALGORITHM', 'VALUE', 'ADDED'],
        secrets.map((secret) => [secret.name, secret.algorithm, secret.hasValue ? 'set' : 'NOT ENTERED YET', secret.createdAt.slice(0, 10)]),
      );
    }

    if (!name) fail(`which secret? konggate secrets ${action} <name>`);
    const existing = (await call('GET', '/secrets')).find((secret) => secret.name === name);

    if (action === 'add') {
      if (existing?.hasValue && !options.replace) fail(`"${name}" already has a value; add --replace to give it another`);

      const value = options['value-file']
        ? readFileSync(path.resolve(options['value-file']), 'utf8').trim()
        : process.env.KONGGATE_SECRET_VALUE ?? (process.stdin.isTTY ? await ask('Secret value: ', { hidden: true }) : await everythingPiped());
      if (!value) fail('no value given');

      const secret = {
        name,
        algorithm: options.algorithm ?? existing?.algorithm ?? 'HS256',
        value,
        valueIsBase64: Boolean(options.base64),
      };
      const headers = await asAdministrator();
      if (existing) await call('PATCH', `/secrets/${existing.id}`, secret, headers);
      else await call('POST', '/secrets', secret, headers);
      return say(`${name} (${secret.algorithm}): ${existing ? 'value entered' : 'added'}.`);
    }

    if (action === 'remove') {
      if (!existing) fail(`no secret called "${name}"`);
      await call('DELETE', `/secrets/${existing.id}`, undefined, await asAdministrator());
      return say(`${name}: removed.`);
    }

    return fail(`secrets ${action}? There is: secrets, secrets add <name>, secrets remove <name>`);
  },

  async password() {
    const { passwordSet } = await call('GET', '/admin');
    if (!passwordSet) {
      const password = await confidential('New administrator password', 'KONGGATE_ADMIN_PASSWORD');
      await call('POST', '/admin/password', { password });
      return say('The administrator\'s password is set.');
    }

    const current = await confidential('Current administrator password', 'KONGGATE_ADMIN_PASSWORD');
    const password = await confidential('New administrator password', 'KONGGATE_NEW_ADMIN_PASSWORD');
    await call('POST', '/admin/password', { password, current });
    return say('The administrator\'s password is changed.');
  },

  async port(number) {
    if (number === undefined && !options.local && !options.public) {
      const { gateway } = await call('GET', '/status');
      return say(`${gateway.port}${gateway.public ? ', open to the network' : ', this computer only'}${gateway.running ? '' : ` (NOT RUNNING: ${gateway.error?.message})`}`);
    }

    const port = number === undefined ? undefined : Number(number);
    if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) fail(`"${number}" is not a port`);

    const { gateway } = await call('PUT', '/settings', {
      gateway: {
        ...(port === undefined ? {} : { port }),
        ...(options.local ? { public: false } : options.public ? { public: true } : {}),
      },
    });
    if (!gateway.running) fail(`the gateway could not start on port ${gateway.port}: ${gateway.error?.message}`);
    return say(`The gateway is on port ${gateway.port}${gateway.public ? ', open to the network' : ', this computer only'}.`);
  },

  async database(action) {
    if (!action) {
      const { database } = await call('GET', '/status');
      if (options.json) return say(JSON.stringify(database, null, 2));
      if (!database.used) return say('The secrets are kept in this computer\'s file. (konggate database set --host <address>)');
      return say(`${database.user}@${database.host}:${database.port}/${database.name}: ${database.connected ? 'connected' : `not connected (${database.error?.message ?? 'still trying'})`}`);
    }

    if (action === 'off') {
      await call('PUT', '/settings', { database: null });
      return say('The secrets are kept in this computer\'s file again.');
    }

    if (action === 'set') {
      if (!options.host) fail('which server? konggate database set --host <address>');
      const database = {
        host: options.host,
        port: Number(options.port ?? 5432),
        database: options.name ?? 'konggate',
        user: options.user ?? 'konggate',
        ssl: Boolean(options.ssl),
        password: await confidential('Database password', 'KONGGATE_DB_PASSWORD'),
      };

      const tried = await call('POST', '/settings/test', { database });
      if (!tried.ok) fail(`not saved: ${tried.error.message}`);
      await call('PUT', '/settings', { database });
      return say(`The secrets now come from ${database.user}@${database.host}:${database.port}/${database.database}.`);
    }

    return fail(`database ${action}? There is: database, database set --host <address>, database off`);
  },

  async log() {
    const limit = Math.max(1, Number(options.limit ?? 20) || 20);
    let requests = await call('GET', '/requests?limit=1000');
    if (options.failed) requests = requests.filter((request) => request.status === null || request.status >= 400);
    requests = requests.slice(0, limit);
    if (options.json) return say(JSON.stringify(requests, null, 2));
    if (requests.length === 0) return say('Nothing recorded. (A work records its requests when that is switched on in it.)');

    table(
      ['TIME', 'WORK', 'REQUEST', 'ANSWER', 'MS', 'WHY'],
      requests.map((request) => [
        new Date(request.time).toLocaleTimeString(),
        request.workName,
        `${request.method} ${request.url.replace(/^https?:\/\/[^/]+/, '')}`,
        request.status ?? '-',
        request.durationMs,
        request.failed ?? (request.answeredBy === 'gateway' ? 'gateway\'s own answer' : ''),
      ]),
    );
  },
};

// --- go --------------------------------------------------------------------------

const [command, ...rest] = words;

try {
  if (!command || command === 'help' || options.help) {
    say(HELP);
  } else if (!Object.hasOwn(commands, command)) {
    fail(`"${command}" is not a command; see: konggate help`);
  } else {
    await commands[command](...rest);
  }
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  console.error(`konggate: ${error.message}`);
  process.exitCode = 1;
}
