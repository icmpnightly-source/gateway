import type {
  ClaimCondition,
  ClaimMapping,
  GatewayRule,
  GatewayRulePayload,
  HttpMethod,
  StaticHeader,
} from '@/types/gateway.types';
import { kongAdmin as admin } from './kongAdmin';

// A same-origin path proxied to the gateway itself by the dev server (vite.config.ts).
export const GATEWAY_PROXY_PATH = '/kong-proxy';

// The ports the gateway and Jaeger are published on. The packaged app is told
// by the web server that serves it (frontend/nginx.conf.template), which
// knows them from its environment; the dev server bakes them in instead.
const published = (window as { __KONGGATE__?: { gatewayPort?: string; jaegerPort?: string } }).__KONGGATE__;

// Both sit on the machine the app itself is served from.
const onPort = (port: string) => `http://${window.location.hostname}:${port}`;

/** Address clients reach the gateway on; shown in the UI, never called from it. */
export const GATEWAY_URL = onPort(published?.gatewayPort || import.meta.env.VITE_GATEWAY_PORT);

/** Where recorded traces can be looked at; only ever linked to. */
export const JAEGER_URL = onPort(published?.jaegerPort || import.meta.env.VITE_JAEGER_PORT);

/** Response header a traced request's id comes back in. */
export const TRACE_ID_HEADER = 'X-Trace-Id';

// Each feature of a rule is one Kong plugin on the rule's route.
const PLUGIN = {
  token: 'jwt-claim-forward',
  requestId: 'correlation-id',
  tracing: 'opentelemetry',
  traceDetails: 'trace-details',
  rateLimit: 'rate-limiting',
  cors: 'cors',
  headers: 'request-transformer',
} as const;

// The most a destination is given just to accept the connection. An address
// that nothing answers on at all should fail fast, however patient the work
// is about the answer itself.
const CONNECT_SECONDS = 5;

// Marks what this UI created, so it never lists or deletes anything else
// configured on the same Kong.
const TAG = 'gateway-ui';

// The second tag on everything a rule is made of: which project it is in.
const PROJECT_TAG = 'project:';

// Kong wants service and route names unique across the whole gateway, while a
// rule's name only has to be unique in its project; so Kong is given the name
// behind a prefix that is the project's own.
const namePrefix = (projectId: string) => `${projectId.slice(0, 8)}.`;

/** What a new rule starts from, and what a rule shows for a feature it never had. */
export function newRule(): GatewayRulePayload {
  return {
    name: '',
    path: '',
    methods: [],
    destination: '',
    stripPath: true,
    timeoutSeconds: 30,
    headers: [],
    token: {
      enabled: true,
      header: 'Authorization',
      claims: [],
      payloadHeader: '',
      forwardToken: true,
      strict: true,
      conditions: [],
      verify: {
        enabled: false,
        secretId: '',
        checkExpiry: true,
        leeway: 0,
        issuer: '',
        audience: '',
      },
    },
    requestId: { enabled: false, header: 'X-Request-Id', echo: true },
    // The collector bundled in docker-compose.yml.
    tracing: {
      enabled: false,
      endpoint: 'http://jaeger:4318/v1/traces',
      serviceName: '',
      samplingPercent: 100,
      details: true,
      body: false,
    },
    rateLimit: { enabled: false, perMinute: 60, by: 'ip', header: '' },
    cors: { enabled: false, origins: ['*'], credentials: false },
  };
}

interface KongService {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  path: string | null;
  /** Milliseconds. */
  read_timeout: number;
}

interface KongRoute {
  id: string;
  name: string | null;
  paths: string[] | null;
  methods: string[] | null;
  strip_path: boolean;
  service: { id: string } | null;
  tags: string[] | null;
  /** Unix seconds. */
  created_at: number;
}

interface KongPlugin<Config = unknown> {
  id: string;
  name: string;
  enabled: boolean;
  route: { id: string } | null;
  config: Config;
}

interface TokenConfig {
  token_header: string;
  claims: ClaimMapping[];
  payload_header: string | null;
  forward_token: boolean;
  strict: boolean;
  conditions: ClaimCondition[];
  verify_signature: boolean;
  secret_id: string | null;
  verify_expiry: boolean;
  leeway: number;
  issuer: string | null;
  audience: string | null;
}

interface RequestIdConfig {
  header_name: string;
  generator: 'uuid';
  echo_downstream: boolean;
}

interface TracingConfig {
  traces_endpoint: string | null;
  resource_attributes: Record<string, string> | null;
  sampling_rate: number | null;
  http_response_header_for_traceid: string | null;
}

interface RateLimitConfig {
  minute: number | null;
  policy: 'local';
  limit_by: string;
  header_name: string | null;
}

interface TraceDetailsConfig {
  /** Lower-case names of the headers whose values are masked. */
  redact_headers: string[];
  capture_body: boolean;
}

interface CorsConfig {
  origins: string[] | null;
  credentials: boolean;
}

interface HeadersConfig {
  // "Name:value" each.
  add: { headers: string[] };
  replace: { headers: string[] };
}

interface KongPage<T> {
  data: T[];
  offset?: string | null;
}

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };

async function listAll<T>(collection: string): Promise<T[]> {
  const items: T[] = [];
  let offset: string | undefined;

  do {
    const { data } = await admin.get<KongPage<T>>(collection, {
      params: { tags: TAG, size: 1000, offset },
    });
    items.push(...data.data);
    offset = data.offset ?? undefined;
  } while (offset);

  return items;
}

function destinationOf(service: KongService) {
  const port = DEFAULT_PORTS[service.protocol] === service.port ? '' : `:${service.port}`;
  return `${service.protocol}://${service.host}${port}${service.path ?? ''}`;
}

function toStaticHeader(entry: string): StaticHeader {
  // Only the first colon separates: a value may be a URL.
  const colon = entry.indexOf(':');
  return { name: entry.slice(0, colon), value: entry.slice(colon + 1) };
}

function toRule(route: KongRoute, service: KongService, plugins: Map<string, KongPlugin>): GatewayRule {
  const defaults = newRule();
  // The map holds every plugin of the route; its name says which config it has.
  const get = <Config,>(name: string) => plugins.get(name) as KongPlugin<Config> | undefined;

  const token = get<TokenConfig>(PLUGIN.token);
  const requestId = get<RequestIdConfig>(PLUGIN.requestId);
  const tracing = get<TracingConfig>(PLUGIN.tracing);
  const traceDetails = get<TraceDetailsConfig>(PLUGIN.traceDetails);
  const rateLimit = get<RateLimitConfig>(PLUGIN.rateLimit);
  const cors = get<CorsConfig>(PLUGIN.cors);
  const headers = get<HeadersConfig>(PLUGIN.headers);

  const projectId = route.tags?.find((tag) => tag.startsWith(PROJECT_TAG))?.slice(PROJECT_TAG.length) ?? '';
  const kongName = route.name ?? service.name;
  const prefix = namePrefix(projectId);
  const name = projectId && kongName.startsWith(prefix) ? kongName.slice(prefix.length) : kongName;
  // Traces are filed under the rule's name unless another was chosen; shown
  // as "not chosen", so that the name keeps following the rule's.
  const traceName = tracing?.config.resource_attributes?.['service.name'] ?? '';

  return {
    id: route.id,
    serviceId: service.id,
    projectId,
    pluginIds: Object.fromEntries([...plugins].map(([name, plugin]) => [name, plugin.id])),
    name,
    path: route.paths?.[0] ?? '/',
    methods: (route.methods ?? []) as HttpMethod[],
    destination: destinationOf(service),
    stripPath: route.strip_path,
    timeoutSeconds: Math.round(service.read_timeout / 1000),
    headers: headers?.enabled ? headers.config.add.headers.map(toStaticHeader) : [],
    token: token
      ? {
          enabled: token.enabled,
          header: token.config.token_header,
          claims: token.config.claims,
          payloadHeader: token.config.payload_header ?? '',
          forwardToken: token.config.forward_token,
          strict: token.config.strict,
          conditions: token.config.conditions,
          verify: {
            enabled: token.config.verify_signature,
            secretId: token.config.secret_id ?? '',
            checkExpiry: token.config.verify_expiry,
            leeway: token.config.leeway,
            issuer: token.config.issuer ?? '',
            audience: token.config.audience ?? '',
          },
        }
      : { ...defaults.token, enabled: false },
    requestId: requestId
      ? {
          enabled: requestId.enabled,
          header: requestId.config.header_name,
          echo: requestId.config.echo_downstream,
        }
      : defaults.requestId,
    tracing: tracing
      ? {
          enabled: tracing.enabled,
          endpoint: tracing.config.traces_endpoint ?? defaults.tracing.endpoint,
          serviceName: traceName === name ? '' : traceName,
          samplingPercent: Math.round((tracing.config.sampling_rate ?? 1) * 100),
          // The details plugin only ever runs alongside tracing, so while
          // tracing is off it says nothing about what was wanted.
          details: tracing.enabled ? Boolean(traceDetails?.enabled) : defaults.tracing.details,
          body: traceDetails?.config.capture_body ?? defaults.tracing.body,
        }
      : defaults.tracing,
    rateLimit: rateLimit
      ? {
          enabled: rateLimit.enabled,
          perMinute: rateLimit.config.minute ?? defaults.rateLimit.perMinute,
          by: rateLimit.config.limit_by === 'header' ? 'header' : 'ip',
          header: rateLimit.config.header_name ?? '',
        }
      : defaults.rateLimit,
    cors: cors
      ? {
          enabled: cors.enabled,
          origins: cors.config.origins ?? defaults.cors.origins,
          credentials: cors.config.credentials,
        }
      : defaults.cors,
    createdAt: new Date(route.created_at * 1000).toISOString(),
  };
}

export async function fetchRules(): Promise<GatewayRule[]> {
  const [routes, services, plugins] = await Promise.all([
    listAll<KongRoute>('/routes'),
    listAll<KongService>('/services'),
    listAll<KongPlugin>('/plugins'),
  ]);

  const serviceById = new Map(services.map((service) => [service.id, service]));
  const pluginsByRoute = new Map<string, Map<string, KongPlugin>>();
  for (const plugin of plugins) {
    if (!plugin.route) continue;
    const ofRoute = pluginsByRoute.get(plugin.route.id) ?? new Map<string, KongPlugin>();
    ofRoute.set(plugin.name, plugin);
    pluginsByRoute.set(plugin.route.id, ofRoute);
  }

  const rules: GatewayRule[] = [];
  for (const route of routes) {
    const service = route.service ? serviceById.get(route.service.id) : undefined;
    if (service) rules.push(toRule(route, service, pluginsByRoute.get(route.id) ?? new Map()));
  }

  return rules.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

interface PluginSpec {
  name: string;
  enabled: boolean;
  config: object;
}

function pluginsOf(rule: GatewayRulePayload): PluginSpec[] {
  const { token, requestId, tracing, rateLimit, cors } = rule;
  const { verify } = token;
  const fixed = rule.headers.map(({ name, value }) => `${name}:${value}`);

  const tokenConfig: TokenConfig = {
    token_header: token.header,
    claims: token.claims,
    payload_header: token.payloadHeader || null,
    forward_token: token.forwardToken,
    strict: token.strict,
    conditions: token.conditions,
    verify_signature: verify.enabled,
    secret_id: verify.secretId || null,
    verify_expiry: verify.checkExpiry,
    leeway: verify.leeway,
    issuer: verify.issuer || null,
    audience: verify.audience || null,
  };
  const requestIdConfig: RequestIdConfig = {
    header_name: requestId.header,
    generator: 'uuid',
    echo_downstream: requestId.echo,
  };
  const tracingConfig: TracingConfig = {
    traces_endpoint: tracing.endpoint,
    resource_attributes: { 'service.name': tracing.serviceName || rule.name },
    sampling_rate: tracing.samplingPercent / 100,
    http_response_header_for_traceid: TRACE_ID_HEADER,
  };
  const traceDetailsConfig: TraceDetailsConfig = {
    // What usually carries credentials, and wherever this rule's token comes in.
    redact_headers: [
      ...new Set([
        'authorization',
        'proxy-authorization',
        'cookie',
        'set-cookie',
        'x-api-key',
        'apikey',
        token.header.toLowerCase(),
      ]),
    ],
    capture_body: tracing.body,
  };
  const rateLimitConfig: RateLimitConfig = {
    minute: rateLimit.perMinute,
    policy: 'local',
    limit_by: rateLimit.by,
    header_name: rateLimit.by === 'header' ? rateLimit.header : null,
  };
  const corsConfig: CorsConfig = { origins: cors.origins, credentials: cors.credentials };
  // "add" only fills a header in and "replace" only overwrites one, so both
  // are needed for the destination to always get exactly this value.
  const headersConfig: HeadersConfig = { add: { headers: fixed }, replace: { headers: fixed } };

  return [
    { name: PLUGIN.token, enabled: token.enabled, config: tokenConfig },
    { name: PLUGIN.requestId, enabled: requestId.enabled, config: requestIdConfig },
    { name: PLUGIN.tracing, enabled: tracing.enabled, config: tracingConfig },
    { name: PLUGIN.traceDetails, enabled: tracing.enabled && tracing.details, config: traceDetailsConfig },
    { name: PLUGIN.rateLimit, enabled: rateLimit.enabled, config: rateLimitConfig },
    { name: PLUGIN.cors, enabled: cors.enabled, config: corsConfig },
    { name: PLUGIN.headers, enabled: fixed.length > 0, config: headersConfig },
  ];
}

// PUT replaces the entity whole, so an edit never leaves stale fields behind;
// POST lets Kong pick the id of a new one.
async function upsert<T extends { id: string }>(collection: string, id: string | undefined, body: object) {
  const { data } = id
    ? await admin.put<T>(`${collection}/${id}`, body)
    : await admin.post<T>(collection, body);
  return data;
}

/**
 * A rule is a Kong service (where to), a route (what comes in) and one plugin
 * per feature on that route, all tagged with the project the rule is in.
 */
export async function saveRule(
  payload: GatewayRulePayload,
  projectId: string,
  existing?: GatewayRule,
): Promise<void> {
  const name = namePrefix(projectId) + payload.name;
  const tags = [TAG, PROJECT_TAG + projectId];

  const service = await upsert<KongService>('/services', existing?.serviceId, {
    name,
    url: payload.destination,
    connect_timeout: Math.min(payload.timeoutSeconds, CONNECT_SECONDS) * 1000,
    read_timeout: payload.timeoutSeconds * 1000,
    write_timeout: payload.timeoutSeconds * 1000,
    // Kong's own default is to try six times over, each with the full
    // timeouts: a request to a dead address then hangs for minutes, and one
    // to a slow service is sent to it again and again.
    retries: 0,
    tags,
  });

  // A browser asks permission with an OPTIONS request first; the route has to
  // accept it for the cors plugin to answer.
  const methods =
    payload.cors.enabled && payload.methods.length > 0 && !payload.methods.includes('OPTIONS')
      ? [...payload.methods, 'OPTIONS']
      : payload.methods;

  let routeId = existing?.id;
  try {
    const route = await upsert<KongRoute>('/routes', routeId, {
      name,
      paths: [payload.path],
      methods: methods.length > 0 ? methods : null,
      strip_path: payload.stripPath,
      service: { id: service.id },
      tags,
    });
    routeId = route.id;

    for (const plugin of pluginsOf(payload)) {
      const id = existing?.pluginIds[plugin.name];
      if (plugin.enabled) {
        await upsert<KongPlugin>('/plugins', id, {
          name: plugin.name,
          route: { id: route.id },
          enabled: true,
          config: plugin.config,
          tags,
        });
      } else if (id) {
        // Switched off rather than deleted, so the rule remembers the
        // feature's settings for when it is switched back on.
        await admin.patch(`/plugins/${id}`, { enabled: false });
      }
    }
  } catch (error) {
    // Don't leave half of a new rule behind. (Its plugins go with the route.)
    if (!existing) {
      if (routeId) await admin.delete(`/routes/${routeId}`).catch(() => undefined);
      await admin.delete(`/services/${service.id}`).catch(() => undefined);
    }
    throw error;
  }
}

export async function deleteRule(rule: GatewayRule): Promise<void> {
  // Deleting the route takes its plugins with it.
  await admin.delete(`/routes/${rule.id}`);
  await admin.delete(`/services/${rule.serviceId}`);
}
