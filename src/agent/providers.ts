import { createProvider, BaseProvider } from '@sschepis/llm-wrapper';
import type { ProviderName, StandardChatParams, StandardChatResponse, StandardChatChunk, LLMError } from '@sschepis/llm-wrapper';
import { resolveApiKey, getProviderMeta, getConfiguredProviders, normalizeBaseUrl } from '../config/provider-registry';
import { inferProviderFromModel, isModelCompatibleWithProvider } from '../config/model-inference';
import type { ClodcodeSettings, PromptRole } from '../config/settings';
import { logger } from '../shared/logger';

export interface ProviderPair {
  local: BaseProvider;
  remote: BaseProvider;
  localModelName: string;
  remoteModelName: string;
}

interface RoundRobinEntry {
  provider: BaseProvider;
  modelName: string;
  providerName: string;
}

class RoundRobinProvider extends BaseProvider {
  readonly providerName = 'round-robin';
  private entries: RoundRobinEntry[];
  private index = 0;

  constructor(entries: RoundRobinEntry[]) {
    super({ apiKey: 'round-robin' });
    this.entries = entries;
  }

  private next(): RoundRobinEntry {
    const entry = this.entries[this.index % this.entries.length];
    this.index++;
    return entry;
  }

  currentLabel(): string {
    const names = this.entries.map(e => `${e.providerName}/${e.modelName}`);
    return `round-robin [${names.join(', ')}]`;
  }

  async chat(params: StandardChatParams): Promise<StandardChatResponse> {
    const entry = this.next();
    logger.info(`Round-robin → ${entry.providerName}/${entry.modelName}`);
    return entry.provider.chat({ ...params, model: entry.modelName });
  }

  stream(params: StandardChatParams): AsyncIterable<StandardChatChunk> {
    const entry = this.next();
    logger.info(`Round-robin → ${entry.providerName}/${entry.modelName}`);
    return entry.provider.stream({ ...params, model: entry.modelName });
  }

  protected doChat(_params: StandardChatParams): Promise<StandardChatResponse> {
    throw new Error('RoundRobinProvider delegates via chat(), not doChat()');
  }
  protected doStream(_params: StandardChatParams): AsyncIterable<StandardChatChunk> {
    throw new Error('RoundRobinProvider delegates via stream(), not doStream()');
  }
  protected mapError(error: unknown): LLMError {
    throw error;
  }
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
 * Apply prompt routing overrides to settings.
 *
 * For the foreground agent (no role):
 *   - `orchestrator` route → overrides local (triage) provider/model
 *   - `actor` route → overrides remote (execution) provider/model
 *
 * For spawned agents with an explicit role:
 *   - That role's route → overrides remote provider/model
 *   - `orchestrator` route → still applies to local for triage
 */
function applyRouteEntry(
  s: ClodcodeSettings,
  entry: { provider: string; model: string },
  slot: 'local' | 'remote',
  label: string,
): boolean {
  // "local" provider sentinel: use the configured local LLM (Ollama/LM Studio)
  if (entry.provider === 'local') {
    if (slot === 'remote') {
      s.remoteProvider = s.localProvider;
      s.remoteModel = entry.model || s.localModel;
      s.remoteApiKey = s.localApiKey;
      s.remoteBaseUrl = s.localBaseUrl;
    } else {
      s.localModel = entry.model || s.localModel;
    }
    logger.info(`Prompt routing: ${label} → local (${s.localProvider}/${entry.model || s.localModel})`);
    return true;
  }

  // Verify the routed provider has an API key before applying
  const meta = getProviderMeta(entry.provider);
  if (meta?.requiresApiKey) {
    const key = resolveApiKey(entry.provider, undefined, s.providerKeys);
    if (!key) {
      logger.warn(`Prompt routing: skipping ${label} → ${entry.provider}/${entry.model} (no API key for ${meta.displayName})`);
      return false;
    }
  }

  if (slot === 'local') {
    s.localProvider = entry.provider;
    s.localModel = entry.model;
    s.localApiKey = '';
    s.localBaseUrl = '';
  } else {
    s.remoteProvider = entry.provider;
    s.remoteModel = entry.model;
    s.remoteApiKey = '';
    s.remoteBaseUrl = '';
  }
  logger.info(`Prompt routing: ${label} → ${entry.provider}/${entry.model}`);
  return true;
}

function applyPromptRouting(settings: ClodcodeSettings, role?: PromptRole): ClodcodeSettings {
  const routing = settings.promptRouting;
  if (!routing || Object.keys(routing).length === 0) return settings;

  const s = { ...settings };

  if (routing.orchestrator && settings.triageEnabled) {
    applyRouteEntry(s, routing.orchestrator, 'local', 'orchestrator');
  }

  if (role) {
    const entry = routing[role];
    if (entry) {
      applyRouteEntry(s, entry, 'remote', role);
    }
  } else {
    if (routing.actor) {
      applyRouteEntry(s, routing.actor, 'remote', 'actor');
    }
  }

  return s;
}

/**
 * Create a pair of LLM providers from extension settings.
 * Resolves API keys from settings, then environment variables.
 *
 * When `role` is specified, prompt routing overrides are applied:
 *   - The role's provider/model becomes the remote slot
 *   - orchestrator routing (if configured) becomes the local slot
 */
export async function createProviders(settings: ClodcodeSettings, role?: PromptRole): Promise<ProviderPair> {
  // ── Apply prompt routing overrides ──
  settings = applyPromptRouting(settings, role);

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

  // ── Round-robin: wrap remote in a rotating provider if enabled ──
  if (settings.roundRobinEnabled && Object.keys(settings.roundRobinModels).length > 0) {
    const rrProvider = await buildRoundRobinProvider(settings, remote);
    if (rrProvider) {
      return {
        local,
        remote: rrProvider,
        localModelName: effectiveLocalModel,
        remoteModelName: `round-robin`,
      };
    }
  }

  return {
    local,
    remote,
    localModelName: effectiveLocalModel,
    remoteModelName: settings.remoteModel,
  };
}

async function buildRoundRobinProvider(
  settings: ClodcodeSettings,
  _fallbackRemote: BaseProvider,
): Promise<RoundRobinProvider | null> {
  const configured = getConfiguredProviders(settings.providerKeys);
  const entries: RoundRobinEntry[] = [];

  for (const [providerName, modelName] of Object.entries(settings.roundRobinModels)) {
    if (!modelName?.trim()) continue;
    if (!configured.includes(providerName)) {
      logger.warn(`Round-robin: skipping "${providerName}" — no API key configured`);
      continue;
    }
    const meta = getProviderMeta(providerName);
    if (!meta) {
      logger.warn(`Round-robin: skipping unknown provider "${providerName}"`);
      continue;
    }
    if (meta.isLocal) {
      logger.warn(`Round-robin: skipping local provider "${providerName}"`);
      continue;
    }

    const apiKey = resolveApiKey(providerName, undefined, settings.providerKeys);
    try {
      const config: Record<string, unknown> = { apiKey };
      if (providerName === settings.remoteProvider && settings.remoteBaseUrl?.trim()) {
        config.baseUrl = settings.remoteBaseUrl.trim();
      }
      const provider =
        providerName === 'azure-openai'
          ? await createAzureOpenAIProvider({ apiKey, endpoint: config.baseUrl as string })
          : await createProvider(providerName as ProviderName, config as any);
      entries.push({ provider, modelName: modelName.trim(), providerName });
      logger.info(`Round-robin: added ${providerName}/${modelName}`);
    } catch (err) {
      logger.warn(`Round-robin: failed to create provider "${providerName}": ${err}`);
    }
  }

  if (entries.length < 2) {
    if (entries.length === 1) {
      logger.warn('Round-robin: only 1 provider available — need at least 2 for rotation. Falling back to single provider.');
    } else {
      logger.warn('Round-robin: no valid providers found in roundRobinModels. Falling back to single provider.');
    }
    return null;
  }

  logger.info(`Round-robin enabled with ${entries.length} providers: ${entries.map(e => e.providerName).join(', ')}`);
  return new RoundRobinProvider(entries);
}
