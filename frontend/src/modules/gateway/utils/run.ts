import { HTTP_METHODS } from '@/types/gateway.types';
import type { GatewayRule, HttpMethod, SendVia, SentHeader } from '@/types/gateway.types';
import { samplePayload } from './token';

/** One line of a list of names and values: a parameter, a header, a form field. */
export interface Row {
  /** Unticked rows stay in the list but are not sent. */
  on: boolean;
  name: string;
  value: string;
}

export type BodyKind = 'none' | 'json' | 'text' | 'form';
export type TokenMode = 'sample' | 'custom' | 'none';

/**
 * A request as it stands on the "try it" page. Kept from one visit to the
 * next, per work; a token of one's own is not part of it, and is never kept.
 */
export interface RunDraft {
  via: SendVia;
  method: HttpMethod;
  /** What follows the work's path, without the query. */
  rest: string;
  params: Row[];
  headers: Row[];
  bodyKind: BodyKind;
  bodyText: string;
  form: Row[];
  tokenMode: TokenMode;
  /** The contents of the sample token, as JSON text. */
  payloadText: string;
}

const storageKey = (workId: string) => `konggate.run.${workId}`;

const BODY_KINDS: BodyKind[] = ['none', 'json', 'text', 'form'];
const TOKEN_MODES: TokenMode[] = ['sample', 'custom', 'none'];

/** The methods a request to the work may use. */
export const methodsOf = (rule: GatewayRule): readonly HttpMethod[] =>
  rule.methods.length > 0 ? rule.methods : HTTP_METHODS;

/**
 * Whether a token can be made up for the work. One that verifies only takes a
 * signed token, and the key to sign with is nobody's to get at.
 */
export const canMakeSample = (rule: GatewayRule) => rule.token.enabled && !rule.token.verify.enabled;

/** The token to start from: none where tokens are not read, a made-up one where that will do. */
export function defaultTokenMode(rule: GatewayRule): TokenMode {
  if (!rule.token.enabled) return 'none';
  return canMakeSample(rule) ? 'sample' : 'custom';
}

function freshDraft(rule: GatewayRule): RunDraft {
  return {
    via: 'gateway',
    method: methodsOf(rule)[0],
    rest: '',
    params: [],
    headers: [],
    bodyKind: 'none',
    bodyText: '',
    form: [],
    tokenMode: defaultTokenMode(rule),
    payloadText: JSON.stringify(samplePayload(rule.token), null, 2),
  };
}

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return [];
    const { on, name, value: held } = row as Partial<Record<keyof Row, unknown>>;
    return [{ on: on !== false, name: text(name, ''), value: text(held, '') }];
  });
}

/** The request left on the work's "try it" page last time, or a blank one. */
export function loadDraft(rule: GatewayRule): RunDraft {
  const fresh = freshDraft(rule);
  try {
    const kept = JSON.parse(localStorage.getItem(storageKey(rule.id)) ?? 'null') as Partial<Record<keyof RunDraft, unknown>> | null;
    if (typeof kept !== 'object' || kept === null) return fresh;

    return {
      via: kept.via === 'direct' ? 'direct' : 'gateway',
      method: HTTP_METHODS.find((method) => method === kept.method) ?? fresh.method,
      rest: text(kept.rest, ''),
      params: rows(kept.params),
      headers: rows(kept.headers),
      bodyKind: BODY_KINDS.find((kind) => kind === kept.bodyKind) ?? 'none',
      bodyText: text(kept.bodyText, ''),
      form: rows(kept.form),
      tokenMode: TOKEN_MODES.find((mode) => mode === kept.tokenMode) ?? fresh.tokenMode,
      payloadText: text(kept.payloadText, fresh.payloadText),
    };
  } catch {
    return fresh;
  }
}

export function saveDraft(workId: string, draft: RunDraft) {
  try {
    localStorage.setItem(storageKey(workId), JSON.stringify(draft));
  } catch {
    // Storage disabled: the page just starts blank next time.
  }
}

/** The rows that are sent: ticked, and with a name. */
export const usedRows = (list: Row[]) => list.filter((row) => row.on && row.name.trim() !== '');

const encoded = (list: Row[]) =>
  usedRows(list)
    .map((row) => `${encodeURIComponent(row.name.trim())}=${encodeURIComponent(row.value)}`)
    .join('&');

/** The parameters as they hang off the address: "?a=1&b=2", or nothing. */
export function queryOf(params: Row[]) {
  const query = encoded(params);
  return query ? `?${query}` : '';
}

/** A form's fields as they travel in a body. */
export const formBody = (form: Row[]) => encoded(form);

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part;
  }
};

/** A path typed or pasted with its query: the path, and the query as rows. */
export function splitQuery(typed: string): { rest: string; params: Row[] } {
  const at = typed.indexOf('?');
  if (at === -1) return { rest: typed, params: [] };

  const params = typed
    .slice(at + 1)
    .split('&')
    .filter(Boolean)
    .map((pair): Row => {
      const equals = pair.indexOf('=');
      return equals === -1
        ? { on: true, name: decoded(pair), value: '' }
        : { on: true, name: decoded(pair.slice(0, equals)), value: decoded(pair.slice(equals + 1)) };
    });
  return { rest: typed.slice(0, at), params };
}

// Inside single quotes a shell reads everything as written, but for the quote itself.
const quoted = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The request as a curl command, to run in a terminal or hand to someone else. */
export function toCurl(request: { method: HttpMethod; url: string; headers: SentHeader[]; body?: string }) {
  const parts = [`curl -X ${request.method} ${quoted(request.url)}`];
  for (const { name, value } of request.headers) parts.push(`-H ${quoted(`${name}: ${value}`)}`);
  if (request.body !== undefined) parts.push(`--data-raw ${quoted(request.body)}`);
  return parts.join(' \\\n  ');
}

/** A size in bytes, in the unit it reads best in. */
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
