// The plugins a work can use: the built-in ones, and custom ones from the
// plugins folder (one .mjs file each). A work lists the plugins it uses, in
// the order they run, each with its settings and switched on or off.
//
// A plugin is an object with a name, a title, the fields of its settings, and
// what it does at each step of a request:
//
//   rewrite(ctx, config)   first, for every plugin of the work, in order
//   access(ctx, config)    then in order, before the request goes on; a
//                          plugin may answer the client itself (ctx.respond),
//                          and the ones after it are not asked
//   response(ctx, config)  when the destination answers, before the client
//                          is given the answer
//
// See README.txt in the plugins folder for what `ctx` holds.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import basicAuth from './basic-auth.mjs';
import cors from './cors.mjs';
import { configFromFields, defaultConfig, describeFields, refuse } from './fields.mjs';
import ipRestriction from './ip-restriction.mjs';
import jwt from './jwt.mjs';
import keyAuth from './key-auth.mjs';
import proxyCache from './proxy-cache.mjs';
import rateLimit from './rate-limit.mjs';
import requestId from './request-id.mjs';
import requestSizeLimit from './request-size-limit.mjs';
import requestTransformer from './request-transformer.mjs';
import responseTransformer from './response-transformer.mjs';
import { PLUGINS_README } from './readme.mjs';

const BUILT_IN = [
  cors,
  ipRestriction,
  requestSizeLimit,
  jwt,
  keyAuth,
  basicAuth,
  rateLimit,
  requestTransformer,
  responseTransformer,
  requestId,
  proxyCache,
];

export const PLUGIN_NAME = /^[a-z][a-z0-9-]{1,48}$/;
const PHASES = ['rewrite', 'access', 'response'];
const MAX_PLUGINS = 50;
// What a plugin this computer does not have may keep in its settings.
const MAX_UNKNOWN_CONFIG = 64 * 1024;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isFunction = (value) => typeof value === 'function';

/** A plugin's description, checked: what the registry keeps. Throws what is wrong with it. */
function definitionFrom(given, { builtIn, file }) {
  if (typeof given !== 'object' || given === null) throw new Error('the file has to `export default { name, ... }`');

  const name = text(given.name);
  if (!PLUGIN_NAME.test(name)) throw new Error(`"name" has to be 2 to 49 small letters, digits and "-", starting with a letter (it is "${name}")`);
  const phases = PHASES.filter((phase) => isFunction(given[phase]));
  if (phases.length === 0) throw new Error(`plugin "${name}" does nothing: give it an access, response or rewrite function`);
  for (const optional of ['check', 'prepare', 'secretHeaders', 'secretQuery']) {
    if (given[optional] !== undefined && !isFunction(given[optional])) throw new Error(`"${optional}" has to be a function`);
  }

  return {
    name,
    title: text(given.title) || name,
    description: text(given.description),
    priority: Number.isFinite(given.priority) ? given.priority : 500,
    onPreflight: Boolean(given.onPreflight),
    builtIn,
    file,
    phases,
    fields: describeFields(given.fields, { builtIn }),
    // Only built-in plugins have forms of their own, and so their own checks.
    configFrom: builtIn && isFunction(given.configFrom) ? given.configFrom : undefined,
    check: given.check,
    prepare: given.prepare,
    secretHeaders: given.secretHeaders,
    secretQuery: given.secretQuery,
    rewrite: given.rewrite,
    access: given.access,
    response: given.response,
    preflight: builtIn ? given.preflight : undefined,
  };
}

/** A plugin as the app's screens are told about it. */
export const describePlugin = (definition) => ({
  name: definition.name,
  title: definition.title,
  description: definition.description,
  priority: definition.priority,
  builtIn: definition.builtIn,
  ...(definition.file ? { file: definition.file } : {}),
  phases: definition.phases,
  onPreflight: definition.onPreflight,
  fields: definition.fields,
  defaults: definition.configFrom ? definition.configFrom({}) : defaultConfig(definition.fields),
});

/**
 * Every plugin this computer has. `dir` is the plugins folder; it is made,
 * with a README, the first time.
 */
export function createPluginRegistry({ dir } = {}) {
  const builtIns = new Map(BUILT_IN.map((plugin) => [plugin.name, definitionFrom(plugin, { builtIn: true })]));
  let custom = new Map();
  let errors = [];

  async function load() {
    const found = new Map();
    const problems = [];

    if (dir) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const readme = path.join(dir, 'README.txt');
      if (!existsSync(readme)) writeFileSync(readme, PLUGINS_README);

      for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.mjs')).sort()) {
        const full = path.join(dir, file);
        try {
          const { mtimeMs, size } = statSync(full);
          // A changed file is read afresh: the address differs from last time's.
          const module = await import(`${pathToFileURL(full).href}?v=${mtimeMs}-${size}`);
          const definition = definitionFrom(module.default, { builtIn: false, file });
          if (builtIns.has(definition.name)) throw new Error(`"${definition.name}" is the name of a built-in plugin`);
          if (found.has(definition.name)) throw new Error(`${found.get(definition.name).file} is also called "${definition.name}"`);
          found.set(definition.name, definition);
        } catch (error) {
          problems.push({ file, message: error?.message ?? String(error) });
        }
      }
    }

    custom = found;
    errors = problems;
  }

  return {
    dir,
    load,
    get: (name) => builtIns.get(name) ?? custom.get(name),
    list: () => [...builtIns.values(), ...custom.values()],
    /** Files in the plugins folder that could not be used, and why. */
    errors: () => errors,
  };
}

// --- a work's plugins ---------------------------------------------------------

/** A plugin's settings from what was sent, as they are kept. */
export function configFor(definition, input, { enabled = true } = {}) {
  const config = definition.configFrom ? definition.configFrom(input ?? {}) : configFromFields(definition.fields, input, definition.title);
  definition.check?.(config, { enabled });
  return config;
}

/**
 * A work's plugins from what was sent: names known or not, each once, every
 * known one's settings checked. A plugin this computer does not have keeps
 * the settings it came with; while it is switched on, the work answers no
 * request (see the gateway).
 */
export function pluginsFrom(input, registry) {
  if (!Array.isArray(input)) refuse('plugins has to be a list');
  if (input.length > MAX_PLUGINS) refuse('a work can have at most 50 plugins');

  const seen = new Set();
  return input.map((item) => {
    const name = text(item?.name);
    if (!PLUGIN_NAME.test(name)) refuse(`"${name}" is not a plugin name`);
    if (seen.has(name)) refuse(`plugin "${name}" is there twice: a work uses each plugin once`);
    seen.add(name);
    const enabled = typeof item?.enabled === 'boolean' ? item.enabled : true;

    const definition = registry.get(name);
    if (definition) return { name, enabled, config: configFor(definition, item?.config, { enabled }) };

    const config = typeof item?.config === 'object' && item.config !== null && !Array.isArray(item.config) ? item.config : {};
    if (JSON.stringify(config).length > MAX_UNKNOWN_CONFIG) refuse(`the settings of plugin "${name}" are too large`);
    return { name, enabled, config: structuredClone(config) };
  });
}

/**
 * A work as it was kept before plugins (token, cors, rateLimit, headers,
 * requestId of its own), as plugins in the order those ran: CORS, the token,
 * the limit, the fixed headers, the request id. What was switched off is
 * left out, but for a token with something set up in it.
 */
export function pluginsFromLegacy(work) {
  const plugins = [];
  const cors = work?.cors ?? {};
  if (cors.enabled) plugins.push({ name: 'cors', enabled: true, config: { origins: cors.origins, credentials: cors.credentials } });

  // A work used to read tokens unless told not to.
  const { enabled: tokenEnabled, ...token } = work?.token ?? {};
  const isSetUp =
    (token.claims ?? []).length > 0 ||
    (token.conditions ?? []).length > 0 ||
    Boolean(token.payloadHeader) ||
    Boolean(token.verify?.enabled) ||
    Boolean(token.verify?.secretId) ||
    Boolean(token.verify?.secret);
  if (tokenEnabled !== false || isSetUp) plugins.push({ name: 'jwt', enabled: tokenEnabled !== false, config: token });

  const limit = work?.rateLimit ?? {};
  if (limit.enabled) plugins.push({ name: 'rate-limit', enabled: true, config: { perMinute: limit.perMinute, by: limit.by, header: limit.header } });

  const headers = Array.isArray(work?.headers) ? work.headers : [];
  if (headers.length > 0) plugins.push({ name: 'request-transformer', enabled: true, config: { setHeaders: headers } });

  const requestIdSettings = work?.requestId ?? {};
  if (requestIdSettings.enabled) {
    plugins.push({ name: 'request-id', enabled: true, config: { header: requestIdSettings.header, echo: requestIdSettings.echo } });
  }
  return plugins;
}

const LEGACY_KEYS = ['token', 'cors', 'rateLimit', 'headers', 'requestId'];

/** A work with plugins, whichever way it came: as it is, or turned from the old shape. */
export function withPlugins(work) {
  if (Array.isArray(work?.plugins)) return work;
  const rest = Object.fromEntries(Object.entries(work ?? {}).filter(([key]) => !LEGACY_KEYS.includes(key)));
  return { ...rest, plugins: pluginsFromLegacy(work) };
}

/** The work's JWT plugin, if it has one. */
export const jwtOf = (work) => (work?.plugins ?? []).find((plugin) => plugin.name === 'jwt');

/** Whether a work checks tokens against this secret. */
export function usesSecret(work, secretId) {
  const plugin = jwtOf(work);
  return Boolean(plugin?.enabled && plugin.config.verify?.enabled && plugin.config.verify.secretId === secretId);
}
