import type { PluginsInfo } from '@/types/gateway.types';
import { engine } from './engine';

// The plugins this computer has: built in, and the files of its plugins folder.

export async function fetchPlugins(): Promise<PluginsInfo> {
  const { data } = await engine.get<PluginsInfo>('/plugins');
  return data;
}

/** Reads the plugins folder again: for a plugin file added or changed meanwhile. */
export async function reloadPlugins(): Promise<PluginsInfo> {
  const { data } = await engine.post<PluginsInfo>('/plugins/reload');
  return data;
}

/** Shows the plugins folder in Explorer; only the desktop app has a window to do it with. */
export async function openPluginsFolder(): Promise<void> {
  await engine.post('/plugins/open');
}
