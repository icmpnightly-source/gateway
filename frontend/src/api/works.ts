import type { GatewayRule, GatewayRulePayload, SendRequest, SendResult } from '@/types/gateway.types';
import { engine } from './engine';

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

/** Adds the rule to the project, or replaces `existing` with it; answers with the rule as saved. */
export async function saveRule(
  payload: GatewayRulePayload,
  projectId: string,
  existing?: GatewayRule,
): Promise<GatewayRule> {
  const { data } = existing
    ? await engine.put<GatewayRule>(`/works/${existing.id}`, payload)
    : await engine.post<GatewayRule>('/works', { ...payload, projectId });
  return data;
}

/**
 * Sends a request built on the "try it" page, and answers with all that came
 * back. The app sends it, not this window: it carries only what was asked for.
 */
export async function sendRequest(workId: string, request: SendRequest): Promise<SendResult> {
  const { data } = await engine.post<SendResult>(`/works/${workId}/send`, request);
  return data;
}

export async function deleteRule(rule: GatewayRule): Promise<void> {
  await engine.delete(`/works/${rule.id}`);
}
