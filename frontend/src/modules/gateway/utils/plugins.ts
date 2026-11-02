import type { TFunction } from 'i18next';
import type {
  GatewayRule,
  GatewayRulePayload,
  JwtConfig,
  PluginDefinition,
  PluginInstance,
  TokenSettings,
} from '@/types/gateway.types';

/** The JWT plugin's settings when it is just added: what a new work used to start with. */
export const DEFAULT_JWT: JwtConfig = {
  header: 'Authorization',
  claims: [],
  payloadHeader: '',
  forwardToken: true,
  strict: true,
  conditions: [],
  verify: { enabled: false, secretId: '', checkExpiry: true, leeway: 0, issuer: '', audience: '' },
};

/** A plugin of the work, by name. */
export const pluginOf = (rule: Pick<GatewayRulePayload, 'plugins'>, name: string): PluginInstance | undefined =>
  (rule.plugins ?? []).find((plugin) => plugin?.name === name);

/** A plugin of the work that is switched on, by name. */
export const enabledPlugin = (rule: Pick<GatewayRulePayload, 'plugins'>, name: string): PluginInstance | undefined => {
  const plugin = pluginOf(rule, name);
  return plugin?.enabled ? plugin : undefined;
};

/**
 * What the work does with tokens, as one object: the JWT plugin's settings,
 * and whether the plugin is there and switched on.
 */
export function tokenOf(rule: Pick<GatewayRule, 'plugins'>): TokenSettings {
  const plugin = pluginOf(rule, 'jwt');
  const config = { ...DEFAULT_JWT, ...(plugin?.config as Partial<JwtConfig> | undefined) };
  return { ...config, verify: { ...DEFAULT_JWT.verify, ...config.verify }, enabled: Boolean(plugin?.enabled) };
}

/** A plugin's name in the app's language: built-in ones have texts of their own. */
export function pluginTitle(t: TFunction, name: string, definition?: PluginDefinition): string {
  if (definition && !definition.builtIn) return definition.title;
  return t(`plugins.builtIn.${name}.title`, { defaultValue: definition?.title ?? name });
}

export function pluginDescription(t: TFunction, definition: PluginDefinition): string {
  if (!definition.builtIn) return definition.description;
  return t(`plugins.builtIn.${definition.name}.description`, { defaultValue: definition.description });
}

/** A plugin just added to a work: switched on, its settings at their defaults. */
export const newInstance = (definition: PluginDefinition): PluginInstance => ({
  name: definition.name,
  enabled: true,
  config: structuredClone(definition.defaults),
});

/**
 * Where a plugin goes when it is added: before the first one that runs later
 * by default (lower priority). A plugin this computer lacks counts as last.
 */
export function insertionIndex(plugins: PluginInstance[], priority: number, definitions: PluginDefinition[]): number {
  const priorityOf = (name: string) => definitions.find((definition) => definition.name === name)?.priority ?? -Infinity;
  const index = plugins.findIndex((plugin) => priorityOf(plugin.name) < priority);
  return index === -1 ? plugins.length : index;
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** A new API key: 32 characters from the browser's own random source. */
export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join('');
}
