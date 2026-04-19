import { createProvider } from '@sschepis/llm-wrapper';
import type { BaseProvider, ProviderName } from '@sschepis/llm-wrapper';
import { resolveApiKey, getProviderMeta, normalizeBaseUrl } from '../config/provider-registry';
import { inferProviderFromModel, isModelCompatibleWithProvider } from '../config/model-inference';
import type { ClodcodeSettings } from '../config/settings';
import { logger } from '../shared/logger';

export interface ProviderPair {
  local: BaseProvider;
  remote: BaseProvider;
  localModelName: string;
  remoteModelName: string;
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

/**
 * Create a pair of LLM providers from extension settings.
 * Resolves API keys from settings, then environment variables.
 */
export async function createProviders(settings: ClodcodeSettings): Promise<ProviderPair> {
  // When triage is disabled, the "local" slot should route to the same
  // powerful model as the remote one. This prevents small local models
  // from producing malformed structured JSON and failing the triage step.
  const effectiveLocalProvider = settings.triageEnabled
    ? settings.localProvider
    : settings.remoteProvider;
  const effectiveLocalModel = settings.triageEnabled
    ? settings.localModel
    : settings.remoteModel;
  const effectiveLocalBaseUrl = settings.triageEnabled
    ? settings.localBaseUrl
    : undefined; // let the remote provider use its default
  const effectiveLocalApiKey = settings.triageEnabled
    ? settings.localApiKey
    : settings.remoteApiKey;

  const localMeta = getProviderMeta(effectiveLocalProvider);
  const remoteMeta = getProviderMeta(settings.remoteProvider);

  // ── Validate provider/model consistency (catches silent mismatches) ──
  if (!remoteMeta) {
    throw new Error(`Unknown remote provider: "${settings.remoteProvider}". Check your Clodcode settings.`);
  }
  if (!localMeta) {
    throw new Error(`Unknown local provider: "${effectiveLocalProvider}". Check your Clodcode settings.`);
  }
  if (!settings.remoteModel) {
    throw new Error(`Remote model name is empty. Open Clodcode Settings and choose a model for "${remoteMeta.displayName}".`);
  }
  if (!effectiveLocalModel) {
    throw new Error(`Local model name is empty. Open Clodcode Settings and choose a model for "${localMeta.displayName}".`);
  }

  // If the model name obviously belongs to a different provider, fail fast
  // with a clear message instead of cascading into a confusing API-key error.
  if (!isModelCompatibleWithProvider(settings.remoteModel, settings.remoteProvider)) {
    const inferredProvider = inferProviderFromModel(settings.remoteModel);
    const inferredMeta = inferredProvider ? getProviderMeta(inferredProvider) : null;
    throw new Error(
      `Mismatch: remote provider is "${remoteMeta.displayName}" but the model "${settings.remoteModel}" ` +
      `looks like ${inferredMeta?.displayName ?? inferredProvider}. ` +
      `Open Clodcode Settings and either change the provider to ${inferredMeta?.displayName ?? 'the matching one'}, ` +
      `or pick a ${remoteMeta.displayName}-compatible model.`
    );
  }

  // ── Build local provider config ──
  // Fail fast if the local provider requires a key and none is configured
  const localApiKey = resolveApiKey(effectiveLocalProvider, effectiveLocalApiKey, settings.providerKeys);
  if (localMeta.requiresApiKey && !localApiKey) {
    throw new Error(
      `API key required for local provider ${localMeta.displayName} (configured model: "${effectiveLocalModel}"). ` +
      `Set it via the ${localMeta.envKeyVar} environment variable, or open Clodcode Settings and fill in the local API key field.`
    );
  }

  const localConfig: Record<string, unknown> = {
    apiKey: localApiKey || 'local',
  };
  const rawLocalBaseUrl = effectiveLocalBaseUrl || localMeta.defaultBaseUrl;
  const normalizedLocalBaseUrl = normalizeBaseUrl(effectiveLocalProvider, rawLocalBaseUrl);
  if (normalizedLocalBaseUrl) {
    localConfig.baseUrl = normalizedLocalBaseUrl;
    if (normalizedLocalBaseUrl !== rawLocalBaseUrl) {
      logger.info(`Normalized local baseUrl: "${rawLocalBaseUrl}" → "${normalizedLocalBaseUrl}"`);
    }
  }

  if (!settings.triageEnabled) {
    logger.info('Triage disabled — routing local calls through the remote provider', {
      provider: effectiveLocalProvider,
      model: effectiveLocalModel,
    });
  }

  // ── Build remote provider config ──
  const remoteApiKey = resolveApiKey(settings.remoteProvider, settings.remoteApiKey, settings.providerKeys);
  if (remoteMeta.requiresApiKey && !remoteApiKey) {
    throw new Error(
      `API key required for ${remoteMeta.displayName} (configured model: "${settings.remoteModel}"). ` +
      `Set it via the ${remoteMeta.envKeyVar} environment variable, or open Clodcode Settings.`
    );
  }

  const remoteConfig: Record<string, unknown> = {
    apiKey: remoteApiKey,
  };
  const remoteBaseUrl = settings.remoteBaseUrl?.trim();
  if (remoteBaseUrl) {
    remoteConfig.baseUrl = remoteBaseUrl;
  }

  // ── Create providers via llm-wrapper factory ──
  const local = effectiveLocalProvider === 'azure-openai'
    ? await createAzureOpenAIProvider({
        apiKey: localApiKey,
        endpoint: normalizedLocalBaseUrl,
        deployment: effectiveLocalModel,
      })
    : await createProvider(effectiveLocalProvider as ProviderName, localConfig as any);

  const remote = settings.remoteProvider === 'azure-openai'
    ? await createAzureOpenAIProvider({
        apiKey: remoteApiKey,
        endpoint: remoteBaseUrl,
        deployment: settings.remoteModel,
      })
    : await createProvider(settings.remoteProvider as ProviderName, remoteConfig as any);

  return {
    local,
    remote,
    localModelName: effectiveLocalModel,
    remoteModelName: settings.remoteModel,
  };
}
