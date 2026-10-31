import type { GatewaySecret, JwtAlgorithm, SecretPayload } from '@/types/gateway.types';
import { kongAdmin } from './kongAdmin';

// Served by the jwt-claim-forward plugin (gateway/plugins/…/api.lua). A
// secret's value goes in and never comes back out, for anyone.

interface KongSecret {
  id: string;
  name: string;
  algorithm: JwtAlgorithm;
  /** Unix seconds. */
  created_at: number;
}

function toSecret(secret: KongSecret): GatewaySecret {
  return {
    id: secret.id,
    name: secret.name,
    algorithm: secret.algorithm,
    createdAt: new Date(secret.created_at * 1000).toISOString(),
  };
}

// What an administrator's calls are authorised with.
const as = (session: string) => ({ headers: { Authorization: `Bearer ${session}` } });

/** Exchanges the administrator's password for a session; rejects when it is wrong. */
export async function signIn(password: string): Promise<string> {
  const { data } = await kongAdmin.post<{ token: string }>('/konggate/login', { password });
  return data.token;
}

export async function fetchSecrets(): Promise<GatewaySecret[]> {
  const { data } = await kongAdmin.get<{ data: KongSecret[] }>('/konggate/secrets');
  return data.data.map(toSecret);
}

export async function createSecret(payload: SecretPayload, session: string): Promise<void> {
  await kongAdmin.post(
    '/konggate/secrets',
    {
      name: payload.name,
      algorithm: payload.algorithm,
      value: payload.value,
      value_is_base64: payload.valueIsBase64,
    },
    as(session),
  );
}

/** An empty value keeps the one the secret holds. */
export async function updateSecret(id: string, payload: SecretPayload, session: string): Promise<void> {
  await kongAdmin.patch(
    `/konggate/secrets/${id}`,
    {
      name: payload.name,
      algorithm: payload.algorithm,
      // Left out rather than sent empty, and the flag with it: it describes the value.
      ...(payload.value ? { value: payload.value, value_is_base64: payload.valueIsBase64 } : {}),
    },
    as(session),
  );
}

export async function deleteSecret(id: string, session: string): Promise<void> {
  await kongAdmin.delete(`/konggate/secrets/${id}`, as(session));
}
