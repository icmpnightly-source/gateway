export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** HS* are verified with a shared secret, every other one with a public key. */
export const JWT_ALGORITHMS = [
  'HS256', 'HS384', 'HS512',
  'RS256', 'RS384', 'RS512',
  'ES256', 'ES384', 'ES512',
  'PS256', 'PS384', 'PS512',
  'EdDSA',
] as const;

export type JwtAlgorithm = (typeof JWT_ALGORITHMS)[number];

export interface ClaimMapping {
  /** Field read from the token payload; dots walk into nested objects ("user.id"). */
  claim: string;
  /** Header the destination receives the value in. */
  header: string;
  /** Reject (401) a token that lacks the field. */
  required: boolean;
}

export interface ClaimCondition {
  /** Field the request is judged by; an array field passes if any item matches. */
  claim: string;
  /** The request is let through only when the field holds one of these. */
  values: string[];
}

export interface StaticHeader {
  name: string;
  value: string;
}

export interface TokenVerification {
  enabled: boolean;
  /**
   * Id of the secret tokens are verified against; empty until one is chosen.
   * The secret also fixes the algorithm tokens must be signed with.
   */
  secretId: string;
  /** Reject expired and not-yet-valid tokens (`exp`, `nbf`). */
  checkExpiry: boolean;
  /** Seconds of clock difference forgiven in the expiry check. */
  leeway: number;
  /** When set, the token's `iss` must equal it. */
  issuer: string;
  /** When set, the token's `aud` must equal or contain it. */
  audience: string;
}

export interface TokenSettings {
  /** Off forwards the request untouched: the token is not even looked at. */
  enabled: boolean;
  /** Header the client sends the token in. */
  header: string;
  claims: ClaimMapping[];
  /** Forward the whole payload (base64url JSON) in this header; empty for none. */
  payloadHeader: string;
  /** Whether the destination also receives the original token. */
  forwardToken: boolean;
  /** Answer 401 when the request carries no token. */
  strict: boolean;
  conditions: ClaimCondition[];
  verify: TokenVerification;
}

export interface RequestIdSettings {
  enabled: boolean;
  /** Header the id travels in; an id the client already sent is kept. */
  header: string;
  /** Also return the id to the client. */
  echo: boolean;
}

export interface TracingSettings {
  enabled: boolean;
  /** OTLP/HTTP address spans are sent to, as seen from the Kong container. */
  endpoint: string;
  /** Name the rule's traces are filed under; empty uses the rule's name. */
  serviceName: string;
  /** Share of requests traced, 0–100. */
  samplingPercent: number;
  /**
   * Also write into each trace what the request looked like when it came in
   * and when it left for the destination. Values of the token's header and of
   * cookies are masked.
   */
  details: boolean;
  /** With the details, the start of a text request body too. It may hold anything the client sends. */
  body: boolean;
}

export interface RateLimitSettings {
  enabled: boolean;
  perMinute: number;
  /** Count per client address, or per value of a request header. */
  by: 'ip' | 'header';
  header: string;
}

export interface CorsSettings {
  enabled: boolean;
  /** Origins allowed to call the rule from a browser; "*" for any. */
  origins: string[];
  credentials: boolean;
}

export interface GatewayRule {
  /** Id of the Kong route behind the rule. */
  id: string;
  serviceId: string;
  /** The project the rule belongs to; empty for one that was made outside any. */
  projectId: string;
  /** Ids of the Kong plugins behind the rule's features, by plugin name. */
  pluginIds: Record<string, string>;
  /** Unique within its project. */
  name: string;
  /** Path prefix the gateway listens on. */
  path: string;
  /** Empty means any method. */
  methods: HttpMethod[];
  /** Base URL matching requests are forwarded to. */
  destination: string;
  /** Drop the matched path prefix before forwarding. */
  stripPath: boolean;
  /** How long the gateway waits for the destination before answering 504. */
  timeoutSeconds: number;
  /** Headers the destination always receives, whatever the client sent. */
  headers: StaticHeader[];
  token: TokenSettings;
  requestId: RequestIdSettings;
  tracing: TracingSettings;
  rateLimit: RateLimitSettings;
  cors: CorsSettings;
  /** ISO date string. */
  createdAt: string;
}

export type GatewayRulePayload = Omit<
  GatewayRule,
  'id' | 'serviceId' | 'projectId' | 'pluginIds' | 'createdAt'
>;

/**
 * A key tokens are verified against, known by its name. Its value is entered
 * by an administrator and never shown to anyone again.
 */
export interface GatewaySecret {
  id: string;
  name: string;
  /** The algorithm tokens verified against it must be signed with. */
  algorithm: JwtAlgorithm;
  /** ISO date string. */
  createdAt: string;
}

export interface SecretPayload {
  name: string;
  algorithm: JwtAlgorithm;
  /** A shared secret for HS*, a PEM public key otherwise. */
  value: string;
  valueIsBase64: boolean;
}

export const TOKEN_FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'null'] as const;

/** One field of a token payload: where it is and what kind of value it holds. */
export interface TokenField {
  /** Dotted path, as a claim mapping takes it. */
  path: string;
  type: (typeof TOKEN_FIELD_TYPES)[number];
}

/** A named group of rules. Everyone sees every project. */
export interface Project {
  id: string;
  name: string;
  /**
   * The shape of the project's tokens, as last read off a sample: what there
   * is to choose from when deciding which fields a rule forwards.
   */
  tokenFields: TokenField[];
  /** ISO date string. */
  createdAt: string;
}

export interface ProjectsState {
  items: Project[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
}

export interface SecretsState {
  items: GatewaySecret[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
}

export interface GatewayState {
  items: GatewayRule[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** The gateway's own explanation of the last failed load, when it gave one. */
  error?: string;
}
