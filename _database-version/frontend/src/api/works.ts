import type { GatewayRule, GatewayRulePayload } from '@/types/gateway.types';
import { engine } from './engine';

/** A same-origin door to the gateway itself, for the "try it" dialog. */
export const TRY_PATH = '/try';

/** Where the app's built-in echo service answers, for trying works out. */
export const ECHO_PATH = '/echo';

/** Response header a recorded request's id comes back in. */
export const TRACE_ID_HEADER = 'X-Trace-Id';

/** What a new rule starts from. */
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
    tracing: { enabled: false, samplingPercent: 100, body: false },
    rateLimit: { enabled: false, perMinute: 60, by: 'ip', header: '' },
    cors: { enabled: false, origins: ['*'], credentials: false },
  };
}

export async function fetchRules(): Promise<GatewayRule[]> {
  const { data } = await engine.get<GatewayRule[]>('/works');
  return data;
}

/** Adds the rule to the project, or replaces `existing` with it. */
export async function saveRule(payload: GatewayRulePayload, projectId: string, existing?: GatewayRule): Promise<void> {
  if (existing) await engine.put(`/works/${existing.id}`, payload);
  else await engine.post('/works', { ...payload, projectId });
}

export async function deleteRule(rule: GatewayRule): Promise<void> {
  await engine.delete(`/works/${rule.id}`);
}
