import type { GatewaySecret, SecretPayload } from '@/types/gateway.types';
import { engine } from './engine';

// A secret's value goes in and never comes back out, for anyone.

// What an administrator's calls are authorised with.
const as = (session: string) => ({ headers: { Authorization: `Bearer ${session}` } });

/** Whether an administrator password exists yet; the first one is set by whoever comes first. */
export async function hasAdminPassword(): Promise<boolean> {
  const { data } = await engine.get<{ passwordSet: boolean }>('/admin');
  return data.passwordSet;
}

/** Sets the first password, or replaces the `current` one. */
export async function setAdminPassword(password: string, current?: string): Promise<void> {
  await engine.post('/admin/password', { password, current });
}

/** Exchanges the administrator's password for a session; rejects when it is wrong. */
export async function signIn(password: string): Promise<string> {
  const { data } = await engine.post<{ token: string }>('/login', { password });
  return data.token;
}

export async function fetchSecrets(): Promise<GatewaySecret[]> {
  const { data } = await engine.get<GatewaySecret[]>('/secrets');
  return data;
}

export async function createSecret(payload: SecretPayload, session: string): Promise<void> {
  await engine.post('/secrets', payload, as(session));
}

/** An empty value keeps the one the secret holds. */
export async function updateSecret(id: string, payload: SecretPayload, session: string): Promise<void> {
  await engine.patch(
    `/secrets/${id}`,
    {
      name: payload.name,
      algorithm: payload.algorithm,
      // Left out rather than sent empty, and the flag with it: it describes the value.
      ...(payload.value ? { value: payload.value, valueIsBase64: payload.valueIsBase64 } : {}),
    },
    as(session),
  );
}

export async function deleteSecret(id: string, session: string): Promise<void> {
  await engine.delete(`/secrets/${id}`, as(session));
}
