// The settings a plugin takes, described field by field: what the app draws a
// form from, and what a work's plugin settings are checked against before
// they are kept. Built-in and custom plugins describe theirs the same way.
//
//   fields: {
//     header: { type: 'string', label: 'Header', default: 'X-API-Key', header: true },
//     limit:  { type: 'number', label: 'Per minute', default: 60, min: 1, max: 100000 },
//   }
//
// Types: string, number, boolean, select (one of `options`), list (of
// strings), pairs (name and value rows). Built-in plugins also use keys (API
// keys, kept as hashes) and users (names and passwords, kept as hashes).

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Refusal } from '../refusal.mjs';

export const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'list', 'pairs', 'keys', 'users'];
// The ones only built-in plugins may use: what they keep is only good to them.
const BUILT_IN_TYPES = new Set(['keys', 'users']);

export const HEADER = /^[A-Za-z0-9_-]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_TEXT = 2000;
const MAX_ROWS = 500;
// The shortest API key taken: long enough that its hash cannot be guessed back.
const MIN_KEY = 16;
const MIN_PASSWORD = 8;

export const refuse = (message) => {
  throw new Refusal(400, message);
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);

// --- keys and passwords --------------------------------------------------------

/** How an API key is kept: never as itself. */
export const keyHash = (key) => createHash('sha256').update(key, 'utf8').digest('hex');

export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex') };
}

export function passwordMatches(password, record) {
  if (typeof password !== 'string' || !record?.salt || !record?.hash) return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(passwordHash(password, record.salt).hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// --- a plugin's description of its fields, checked once when it is loaded -------

/**
 * The fields as a list, every one complete, or a refusal saying what is wrong
 * with the description. `builtIn` allows the types only built-in plugins use.
 */
export function describeFields(fields, { builtIn = false } = {}) {
  if (fields === undefined) return [];
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new Error('"fields" has to be an object: { name: { type, label, ... } }');
  }

  return Object.entries(fields).map(([key, field]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`field "${key}": the name may hold letters, digits and "_"`);
    if (typeof field !== 'object' || field === null) throw new Error(`field "${key}" has to be an object`);
    if (!FIELD_TYPES.includes(field.type) || (!builtIn && BUILT_IN_TYPES.has(field.type))) {
      throw new Error(`field "${key}": type has to be one of ${FIELD_TYPES.filter((type) => builtIn || !BUILT_IN_TYPES.has(type)).join(', ')}`);
    }
    const options = field.type === 'select' ? list(field.options).map(String) : undefined;
    if (field.type === 'select' && options.length === 0) throw new Error(`field "${key}": a select needs "options"`);

    const described = {
      key,
      type: field.type,
      label: typeof field.label === 'string' && field.label ? field.label : key,
      help: typeof field.help === 'string' ? field.help : '',
      required: Boolean(field.required),
      header: Boolean(field.header),
    };
    if (options) described.options = options;
    if (field.type === 'number') {
      described.min = Number.isFinite(field.min) ? field.min : 0;
      described.max = Number.isFinite(field.max) ? field.max : 1_000_000_000;
    }
    if (typeof field.placeholder === 'string') described.placeholder = field.placeholder;
    described.default = defaultOf(described, field.default);
    return described;
  });
}

function defaultOf(field, given) {
  switch (field.type) {
    case 'string':
      return typeof given === 'string' ? given : '';
    case 'number':
      return Number.isFinite(given) ? given : field.min;
    case 'boolean':
      return typeof given === 'boolean' ? given : false;
    case 'select':
      return field.options.includes(String(given)) ? String(given) : field.options[0];
    case 'list':
      return list(given).map(String);
    case 'pairs':
      return list(given).map((pair) => ({ name: String(pair?.name ?? ''), value: String(pair?.value ?? '') }));
    default:
      return [];
  }
}

// --- a work's settings for a plugin, checked against its fields -----------------

function headerName(value, what) {
  if (!HEADER.test(value)) refuse(`${what}: "${value}" is not a header name`);
  return value;
}

function oneLine(value, what) {
  if (CONTROL.test(value)) refuse(`${what}: has to be on one line`);
  if (value.length > MAX_TEXT) refuse(`${what}: is too long`);
  return value;
}

function checkedValue(field, input, what) {
  switch (field.type) {
    case 'string': {
      const value = input === undefined ? field.default : text(input);
      if (value === '') {
        if (field.required) refuse(`${what}: needs a value`);
        return '';
      }
      return field.header ? headerName(value, what) : oneLine(value, what);
    }

    case 'number': {
      const number = input === undefined || input === '' || input === null ? field.default : Number(input);
      if (!Number.isFinite(number)) refuse(`${what}: has to be a number`);
      return Math.min(field.max, Math.max(field.min, number));
    }

    case 'boolean':
      return typeof input === 'boolean' ? input : field.default;

    case 'select': {
      const value = input === undefined ? field.default : String(input);
      if (!field.options.includes(value)) refuse(`${what}: has to be one of ${field.options.join(', ')}`);
      return value;
    }

    case 'list': {
      const values = (input === undefined ? field.default : list(input)).map(text).filter(Boolean);
      if (values.length > MAX_ROWS) refuse(`${what}: too many values`);
      if (field.required && values.length === 0) refuse(`${what}: needs at least one value`);
      return [...new Set(values.map((value) => (field.header ? headerName(value, what) : oneLine(value, what))))];
    }

    case 'pairs': {
      const rows = (input === undefined ? field.default : list(input))
        .map((row) => ({ name: text(row?.name), value: typeof row?.value === 'string' ? row.value.trim() : '' }))
        // A row left empty is one nobody filled in.
        .filter((row) => row.name !== '' || row.value !== '');
      if (rows.length > MAX_ROWS) refuse(`${what}: too many rows`);
      if (field.required && rows.length === 0) refuse(`${what}: needs at least one row`);
      return rows.map((row) => {
        if (row.name === '' || row.value === '') refuse(`${what}: every row needs a name and a value`);
        return {
          name: field.header ? headerName(row.name, what) : oneLine(row.name, what),
          value: oneLine(row.value, what),
        };
      });
    }

    case 'keys':
      return checkedKeys(input, what);

    case 'users':
      return checkedUsers(input, what);

    default:
      return undefined;
  }
}

/**
 * API keys: a new one comes as `key` and is kept as its hash, with its last
 * characters to tell it by; one kept already comes back as the `hash` it was
 * given out with. The key itself is never kept, nor given out again.
 */
function checkedKeys(input, what) {
  const seen = new Set();
  const names = new Set();
  return list(input).map((row) => {
    const name = text(row?.name);
    if (!name) refuse(`${what}: every key needs a name`);
    oneLine(name, what);
    if (names.has(name)) refuse(`${what}: two keys are named "${name}"`);
    names.add(name);

    let kept;
    const key = typeof row?.key === 'string' ? row.key.trim() : '';
    if (key) {
      if (key.length < MIN_KEY || /\s/.test(key)) refuse(`${what}: "${name}": a key needs ${MIN_KEY} characters or more, without spaces`);
      kept = { name, hash: keyHash(key), hint: key.slice(-4) };
    } else {
      const hash = text(row?.hash);
      if (!/^[0-9a-f]{64}$/.test(hash)) refuse(`${what}: "${name}" has no key`);
      kept = { name, hash, hint: text(row?.hint).slice(-4) };
    }

    if (seen.has(kept.hash)) refuse(`${what}: two names share one key`);
    seen.add(kept.hash);
    return kept;
  });
}

/** Users for basic sign-in: a new password is kept as a salted hash, never as itself. */
function checkedUsers(input, what) {
  const names = new Set();
  return list(input).map((row) => {
    const username = text(row?.username);
    if (!username || username.includes(':')) refuse(`${what}: every user needs a name, without ":"`);
    oneLine(username, what);
    if (names.has(username)) refuse(`${what}: "${username}" is there twice`);
    names.add(username);

    const password = typeof row?.password === 'string' ? row.password : '';
    if (password) {
      if (password.length < MIN_PASSWORD) refuse(`${what}: "${username}": a password needs ${MIN_PASSWORD} characters or more`);
      return { username, ...passwordHash(password) };
    }
    const salt = text(row?.salt);
    const hash = text(row?.hash);
    if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(hash)) refuse(`${what}: "${username}" has no password`);
    return { username, salt, hash };
  });
}

/** A plugin's settings from what was sent: every field there, of its kind. */
export function configFromFields(fields, input, pluginTitle) {
  const given = typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
  const config = {};
  for (const field of fields) {
    config[field.key] = checkedValue(field, given[field.key], `${pluginTitle}: ${field.label}`);
  }
  return config;
}

/** Every field at its default: a plugin just added to a work. */
export const defaultConfig = (fields) => Object.fromEntries(fields.map((field) => [field.key, structuredClone(field.default)]));
