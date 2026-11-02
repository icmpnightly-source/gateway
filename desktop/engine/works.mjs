// What a work may hold, checked: its route (path, methods, destination), its
// requests log, and its plugins. A work in the shape it had before plugins
// (token, cors, rateLimit, headers and requestId of its own) is turned into
// the plugins that do the same.

import { configFor, pluginsFrom, withPlugins } from './plugins/index.mjs';
import { refuse } from './plugins/fields.mjs';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const NAME = /^[\p{L}\p{N}._~-]+$/u;
const PATH = /^\/(?!.*\/\/)[^\s?#]*$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);
const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

function whole(value, { min, max, fallback }) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * A work as it is stored, from whatever was sent: every field present and of
 * its kind, so the gateway never has to doubt what it reads. `registry` knows
 * the plugins and checks their settings.
 */
export function workFrom(input, registry) {
  const name = text(input?.name);
  if (!NAME.test(name)) refuse('the name may hold letters, digits, dots, dashes and underscores');

  const workPath = text(input?.path);
  if (!PATH.test(workPath)) refuse('the path has to start with "/" and hold no spaces, "?" or "#"');

  const methods = [...new Set(list(input?.methods))];
  if (methods.some((method) => !METHODS.includes(method))) refuse('unknown method');

  const destination = text(input?.destination);
  let url;
  try {
    url = new URL(destination);
  } catch {
    refuse('the destination is not a full address');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    refuse('the destination has to be an http:// or https:// address without "?" or "#"');
  }

  const tracing = input?.tracing ?? {};

  const config = {
    path: workPath,
    methods,
    destination,
    stripPath: flag(input?.stripPath, true),
    timeoutSeconds: whole(input?.timeoutSeconds, { min: 1, max: 600, fallback: 30 }),
    tracing: {
      enabled: flag(tracing.enabled, false),
      samplingPercent: whole(tracing.samplingPercent, { min: 0, max: 100, fallback: 100 }),
      body: flag(tracing.body, false),
    },
    plugins: pluginsFrom(withPlugins(input).plugins, registry),
  };

  return { name, config };
}

/**
 * A work kept in the data file before plugins, in today's shape. Kept works
 * were checked when they were saved, so this does not fail; if it ever did,
 * the work is held shut (a plugin nobody has) rather than opened up.
 */
export function migratedWork(work, registry, report = console.error) {
  if (Array.isArray(work?.plugins)) return work;
  const shaped = withPlugins(work);
  try {
    return {
      ...shaped,
      plugins: shaped.plugins.map((plugin) => {
        const definition = registry.get(plugin.name);
        return { ...plugin, config: configFor(definition, plugin.config, { enabled: false }) };
      }),
    };
  } catch (error) {
    report(error);
    return { ...shaped, plugins: [{ name: 'needs-review', enabled: true, config: {} }] };
  }
}
