import type { GatewayRule, GatewayRulePayload, SendRequest, SendResult } from '@/types/gateway.types';
import { DEFAULT_JWT } from '@/modules/gateway/utils/plugins';
import { engine } from './engine';

/** Where the app's built-in echo service answers, for trying works out. */
export const ECHO_PATH = '/echo';

/** Response header a recorded request's id comes back in. */
export const TRACE_ID_HEADER = 'X-Trace-Id';

/** What a new rule starts from: reading tokens, as a new work always did. */
export function newRule(): GatewayRulePayload {
  return {
    name: '',
    path: '',
    methods: [],
    destination: '',
    stripPath: true,
    timeoutSeconds: 30,
    tracing: { enabled: false, samplingPercent: 100, body: false },
    plugins: [{ name: 'jwt', enabled: true, config: structuredClone(DEFAULT_JWT) as unknown as Record<string, unknown> }],
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
