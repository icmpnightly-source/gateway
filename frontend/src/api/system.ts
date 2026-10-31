import type {
  ConnectionError,
  DatabaseSettings,
  GatewaySettings,
  OnClose,
  RequestRecord,
  RequestSummary,
  ShownSettings,
  SystemStatus,
} from '@/types/system.types';
import { engine } from './engine';

// How the app runs on this computer: its gateway's port, the shared database
// its secrets come from, and the requests that went through its gateway.

export async function fetchStatus(): Promise<SystemStatus> {
  const { data } = await engine.get<SystemStatus>('/status');
  return data;
}

export async function fetchSettings(): Promise<ShownSettings> {
  const { data } = await engine.get<ShownSettings>('/settings');
  return data;
}

/** A password left out means "the one already saved". */
export type DatabaseInput = Omit<DatabaseSettings, 'hasPassword'> & { password?: string };

/** Tries the connection without saving anything. */
export async function testDatabase(database: DatabaseInput): Promise<{ ok: boolean; error?: ConnectionError }> {
  const { data } = await engine.post<{ ok: boolean; error?: ConnectionError }>('/settings/test', { database });
  return data;
}

/**
 * Saves and applies at once; answers with how things stand afterwards.
 * `database: null` goes back to keeping the secrets in this computer's file.
 */
export async function saveSettings(settings: {
  gateway?: GatewaySettings;
  window?: { onClose: OnClose };
  database?: DatabaseInput | null;
}): Promise<SystemStatus> {
  const { data } = await engine.put<SystemStatus>('/settings', settings);
  return data;
}

export async function fetchRequests(filter: { projectId?: string; workId?: string } = {}): Promise<RequestSummary[]> {
  const { data } = await engine.get<RequestSummary[]>('/requests', { params: { ...filter, limit: 300 } });
  return data;
}

export async function fetchRequest(id: string): Promise<RequestRecord> {
  const { data } = await engine.get<RequestRecord>(`/requests/${id}`);
  return data;
}

export async function clearRequests(): Promise<void> {
  await engine.delete('/requests');
}
