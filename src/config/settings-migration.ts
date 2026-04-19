import * as vscode from 'vscode';
import { EXTENSION_ID, ENV_KEY_MAP } from '../shared/constants';
import { PROVIDERS } from './provider-registry';
import { logger } from '../shared/logger';
import type { ProviderConfig, RouteAssignment } from './settings';

const OLD_KEYS = [
  'localProvider', 'localModel', 'localBaseUrl', 'localApiKey',
  'remoteProvider', 'remoteModel', 'remoteApiKey', 'remoteBaseUrl',
  'providerKeys', 'promptRouting', 'roundRobinEnabled', 'roundRobinModels',
] as const;

export async function migrateSettingsIfNeeded(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);

  const hasOldKeys = OLD_KEYS.some(k => cfg.get(k) !== undefined && cfg.inspect(k)?.globalValue !== undefined);
  const hasNewKeys = cfg.inspect('providers')?.globalValue !== undefined
    || cfg.inspect('routing')?.globalValue !== undefined;

  if (!hasOldKeys || hasNewKeys) return;

  logger.info('Migrating settings from old format to new provider/routing format');

  try {
    const providers: Record<string, ProviderConfig> = {};
    const routing: Partial<Record<string, RouteAssignment>> = {};

    const remoteProvider = cfg.get<string>('remoteProvider');
    const remoteModel = cfg.get<string>('remoteModel');
    const remoteApiKey = cfg.get<string>('remoteApiKey');
    const remoteBaseUrl = cfg.get<string>('remoteBaseUrl');

    if (remoteProvider && remoteProvider !== 'ollama') {
      const id = remoteProvider;
      providers[id] = {
        type: remoteProvider,
        defaultModel: remoteModel || undefined,
        apiKey: remoteApiKey || undefined,
        baseUrl: remoteBaseUrl || undefined,
      };
      routing.executor = { providerId: id, model: remoteModel || undefined };
    }

    const localProvider = cfg.get<string>('localProvider');
    const localModel = cfg.get<string>('localModel');
    const localApiKey = cfg.get<string>('localApiKey');
    const localBaseUrl = cfg.get<string>('localBaseUrl');

    if (localProvider === 'ollama' || !localProvider) {
      routing.triage = { providerId: 'oboto', model: localModel || undefined };
    } else {
      if (!providers[localProvider]) {
        providers[localProvider] = {
          type: localProvider,
          defaultModel: localModel || undefined,
          apiKey: localApiKey || undefined,
          baseUrl: localBaseUrl || undefined,
        };
      }
      routing.triage = { providerId: localProvider, model: localModel || undefined };
    }

    const providerKeys = cfg.get<Record<string, string>>('providerKeys', {});
    for (const [provType, apiKey] of Object.entries(providerKeys)) {
      if (!apiKey) continue;
      if (providers[provType]) {
        if (!providers[provType].apiKey) providers[provType].apiKey = apiKey;
      } else {
        providers[provType] = { type: provType, apiKey };
      }
    }

    const oldRouting = cfg.get<Record<string, { provider?: string; model?: string }>>('promptRouting', {});
    const roleMap: Record<string, string> = {
      orchestrator: 'triage',
      actor: 'executor',
      planner: 'planner',
      summarizer: 'summarizer',
    };
    for (const [oldRole, entry] of Object.entries(oldRouting)) {
      const newRole = roleMap[oldRole];
      if (!newRole || !entry?.provider) continue;
      if (entry.provider === 'local') {
        routing[newRole] = { providerId: 'oboto', model: entry.model || undefined };
      } else {
        if (!providers[entry.provider]) {
          providers[entry.provider] = { type: entry.provider };
        }
        routing[newRole] = { providerId: entry.provider, model: entry.model || undefined };
      }
    }

    if (Object.keys(providers).length > 0) {
      await cfg.update('providers', providers, vscode.ConfigurationTarget.Global);
    }
    if (Object.keys(routing).length > 0) {
      await cfg.update('routing', routing, vscode.ConfigurationTarget.Global);
    }

    for (const key of OLD_KEYS) {
      const inspect = cfg.inspect(key);
      if (inspect?.globalValue !== undefined) {
        await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
    }

    logger.info('Settings migration complete', {
      providers: Object.keys(providers),
      routing: Object.keys(routing),
    });
  } catch (err) {
    logger.error('Settings migration failed — old keys preserved', err);
  }
}

export async function autoDetectProviders(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
  const existing = cfg.get<Record<string, ProviderConfig>>('providers', {});

  const existingTypes = new Set(Object.values(existing).map(p => p.type));

  const detected: Record<string, ProviderConfig> = {};

  for (const [providerType, envVar] of Object.entries(ENV_KEY_MAP)) {
    if (!envVar || !process.env[envVar]) continue;
    if (providerType === 'ollama' || providerType === 'lmstudio') continue;
    if (existingTypes.has(providerType)) continue;

    const meta = PROVIDERS[providerType];
    if (!meta) continue;

    detected[providerType] = {
      type: providerType,
      label: meta.displayName,
    };
  }

  if (Object.keys(detected).length === 0) return;

  const merged = { ...existing, ...detected };
  await cfg.update('providers', merged, vscode.ConfigurationTarget.Global);

  logger.info('Auto-detected providers from environment', {
    detected: Object.keys(detected),
  });
}
