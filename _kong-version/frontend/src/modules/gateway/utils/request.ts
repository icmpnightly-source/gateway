import type { GatewayRulePayload } from '@/types/gateway.types';

const trimEnd = (value: string) => value.replace(/\/+$/, '');

/** Joins a path and what follows it with exactly one slash between them. */
export function joinPath(path: string, rest: string) {
  const tail = rest.replace(/^\/+/, '');
  if (!tail) return path;

  // A query string hangs off the path itself, not off a new segment.
  return tail.startsWith('?') ? `${path}${tail}` : `${trimEnd(path)}/${tail}`;
}

/** Where a request for `rule.path` + `rest` ends up, following Kong's strip_path rule. */
export function upstreamUrl(
  rule: Pick<GatewayRulePayload, 'destination' | 'path' | 'stripPath'>,
  rest: string,
) {
  const forwarded = joinPath(rule.stripPath ? '/' : rule.path, rest);
  return trimEnd(rule.destination) + forwarded;
}
