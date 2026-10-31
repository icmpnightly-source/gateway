import { AppWindow, Database, HardDrive, KeyRound, Palette, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SettingsSection } from '@/router/routes';

/** The settings' sections, in the order they are listed; each label is a text key. */
export const SETTINGS_ITEMS: { id: SettingsSection; icon: LucideIcon; label: string }[] = [
  { id: 'gateway', icon: Waypoints, label: 'system.gateway' },
  { id: 'appearance', icon: Palette, label: 'system.appearance' },
  { id: 'window', icon: AppWindow, label: 'system.window' },
  { id: 'database', icon: Database, label: 'system.secretsDb' },
  { id: 'data', icon: HardDrive, label: 'system.data' },
  { id: 'admin', icon: KeyRound, label: 'system.adminPassword' },
];
