import { createProvider, BaseProvider } from '@sschepis/llm-wrapper';
import type { ProviderName } from '@sschepis/llm-wrapper';
import { getProviderMeta, normalizeBaseUrl } from '../config/provider-registry';
import type { ObotovsSettings, PromptRole, ProviderConfig } from '../config/settings';
import { MANAGED_PROVIDER_ID, ensureManagedProvider } from '../config/managed-provider';
import { ENV_KEY_MAP } from '../shared/constants';
import { logger } from '../shared/logger';
import { VSCodeLMProvider } from '../config/vscode-lm-provider';

export interface ProviderPair {
  local: BaseProvider;
  remote: BaseProvider;
  localModelName: string;
  remoteModelName: string;
}

export interface ResolvedRole {
  providerId: string;
  model: string;
  providerType: string;
}

export function resolveRole(
  role: PromptRole,
  settings: ObotovsSettings,
): ResolvedRole {
  if (role === 'triage' && !settings.triageEnabled) {
    return resolveRole('executor', settings);
  }

  const entry = settings.routing[role];
  if (entry) {
    const providerId = entry.providerId;
    const providerType = resolveProviderType(providerId, settings);
    const model = entry.model || resolveDefaultModel(providerId, settings);
    return { providerId, model, providerType };
  }

  if (role !== 'executor') {
    return resolveRole('executor', settings);
  }

  throw new Error('No executor provider configured. Open Oboto Settings and assign a provider to the Executor role.');
}

function resolveProviderType(providerId: string, settings: ObotovsSettings): string {
  if (providerId === MANAGED_PROVIDER_ID) return 'ollama';
  const config = settings.providers[providerId];
  return config?.type ?? providerId;
}

function resolveDefaultModel(providerId: string, settings: ObotovsSettings): string {
  if (providerId === MANAGED_PROVIDER_ID) return '';
  const config = settings.providers[providerId];
  return config?.defaultModel ?? '';
}

async function createAzureOpenAIProvider(config: {
  apiKey: string;
  endpoint?: string;
  deployment?: string;
  apiVersion?: string;
}): Promise<BaseProvider> {
  const provider = await createProvider('openai' as ProviderName, {
    apiKey: config.apiKey || 'azure',
  } as any);

  const { AzureOpenAI } = await import('openai');
  (provider as any).client = new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint: config.endpoint || undefined,
    deployment: config.deployment || undefined,
    apiVersion: config.apiVersion || '2024-10-21',
  });

  return provider;
}

async function buildProvider(
  providerId: string,
  model: string,
  settings: ObotovsSettings,
): Promise<BaseProvider> {
  if (providerId === MANAGED_PROVIDER_ID) {
    const status = await ensureManagedProvider(model);
    const baseUrl = normalizeBaseUrl('ollama', status.baseUrl);
    return createProvider('ollama' as ProviderName, {
      apiKey: 'local',
      baseUrl,
    } as any);
  }

  const providerConfig = settings.providers[providerId];
  if (!providerConfig) {
    throw new Error(
      `Provider "${providerId}" is not configured. Open Oboto Settings and add it.`,
    );
  }

  const providerType = providerConfig.type;

  if (providerType === 'vscode-lm') {
    return new VSCodeLMProvider({ apiKey: 'vscode-lm' });
  }

  const meta = getProviderMeta(providerType);
  if (!meta) {
    throw new Error(`Unknown provider type "${providerType}" for provider "${providerId}".`);
  }

  const apiKey = resolveProviderApiKey(providerConfig);
  if (meta.requiresApiKey && !apiKey) {
    const envVar = ENV_KEY_MAP[providerType] || '';
    throw new Error(
      `API key required for ${meta.displayName} (provider "${providerId}", model "${model}"). ` +
      (envVar
        ? `Set the ${envVar} environment variable or add an apiKey in Oboto Settings.`
        : `Add an apiKey in Oboto Settings.`),
    );
  }

  const config: Record<string, unknown> = {
    apiKey: apiKey || 'local',
  };

  const rawBaseUrl = providerConfig.baseUrl || meta.defaultBaseUrl;
  const baseUrl = normalizeBaseUrl(providerType, rawBaseUrl);
  if (baseUrl) config.baseUrl = baseUrl;

  if (providerType === 'azure-openai') {
    return createAzureOpenAIProvider({
      apiKey: apiKey || '',
      endpoint: baseUrl,
      deployment: model,
    });
  }

  if (providerType === 'openclaw') {
    const { ensureOpenClaw } = await import('../config/openclaw-manager');
    const status = await ensureOpenClaw();
    config.baseUrl = status.url;
    return createProvider('openai' as ProviderName, config as any);
  }

  return createProvider(providerType as ProviderName, config as any);
}

function resolveProviderApiKey(config: ProviderConfig): string {
  if (config.apiKey?.trim()) return config.apiKey.trim();
  const envVar = ENV_KEY_MAP[config.type];
  if (envVar) return process.env[envVar] || '';
  return '';
}

export async function createProviders(
  settings: ObotovsSettings,
  role?: PromptRole,
): Promise<ProviderPair> {
  const triageResolved = resolveRole('triage', settings);
  const execResolved = resolveRole(role ?? 'executor', settings);

  logger.info('Creating providers', {
    triage: `${triageResolved.providerId}/${triageResolved.model}`,
    executor: `${execResolved.providerId}/${execResolved.model}`,
  });

  const local = await buildProvider(triageResolved.providerId, triageResolved.model, settings);
  const remote = await buildProvider(execResolved.providerId, execResolved.model, settings);

  return {
    local,
    remote,
    localModelName: triageResolved.model,
    remoteModelName: execResolved.model,
  };
}
