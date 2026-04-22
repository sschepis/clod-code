import { ENV_KEY_MAP, DEFAULT_LOCAL_BASE_URLS } from '../shared/constants';

export interface ProviderMeta {
  name: string;
  displayName: string;
  envKeyVar: string;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  isLocal: boolean;
}

export const PROVIDERS: Record<string, ProviderMeta> = {
  ollama: {
    name: 'ollama',
    displayName: 'Ollama',
    envKeyVar: '',
    defaultBaseUrl: DEFAULT_LOCAL_BASE_URLS.ollama,
    requiresApiKey: false,
    isLocal: true,
  },
  lmstudio: {
    name: 'lmstudio',
    displayName: 'LM Studio',
    envKeyVar: '',
    defaultBaseUrl: DEFAULT_LOCAL_BASE_URLS.lmstudio,
    requiresApiKey: false,
    isLocal: true,
  },
  openclaw: {
    name: 'openclaw',
    displayName: 'OpenClaw Gateway',
    envKeyVar: '',
    defaultBaseUrl: 'http://localhost:8099/v1',
    requiresApiKey: false,
    isLocal: true,
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    envKeyVar: ENV_KEY_MAP.openai,
    requiresApiKey: true,
    isLocal: false,
  },
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    envKeyVar: ENV_KEY_MAP.anthropic,
    requiresApiKey: true,
    isLocal: false,
  },
  gemini: {
    name: 'gemini',
    displayName: 'Google Gemini',
    envKeyVar: ENV_KEY_MAP.gemini,
    requiresApiKey: true,
    isLocal: false,
  },
  'vertex-gemini': {
    name: 'vertex-gemini',
    displayName: 'Vertex AI (Gemini)',
    envKeyVar: ENV_KEY_MAP['vertex-gemini'],
    requiresApiKey: false, // Uses ADC
    isLocal: false,
  },
  'vertex-anthropic': {
    name: 'vertex-anthropic',
    displayName: 'Vertex AI (Anthropic)',
    envKeyVar: ENV_KEY_MAP['vertex-anthropic'],
    requiresApiKey: false,
    isLocal: false,
  },
  openrouter: {
    name: 'openrouter',
    displayName: 'OpenRouter',
    envKeyVar: ENV_KEY_MAP.openrouter,
    requiresApiKey: true,
    isLocal: false,
  },
  deepseek: {
    name: 'deepseek',
    displayName: 'DeepSeek',
    envKeyVar: ENV_KEY_MAP.deepseek,
    requiresApiKey: true,
    isLocal: false,
  },
  'azure-openai': {
    name: 'azure-openai',
    displayName: 'Azure OpenAI',
    envKeyVar: ENV_KEY_MAP['azure-openai'],
    requiresApiKey: true,
    isLocal: false,
  },
  'vscode-lm': {
    name: 'vscode-lm',
    displayName: 'VS Code Copilot',
    envKeyVar: '',
    requiresApiKey: false,
    isLocal: false,
  },
};

export function getProviderMeta(providerName: string): ProviderMeta | undefined {
  return PROVIDERS[providerName];
}

export function resolveApiKey(
  providerName: string,
  settingsKey?: string,
  providerKeys?: Record<string, string>,
): string {
  if (settingsKey && settingsKey.trim().length > 0) return settingsKey.trim();
  if (providerKeys?.[providerName]?.trim()) return providerKeys[providerName].trim();
  const meta = PROVIDERS[providerName];
  if (!meta || !meta.envKeyVar) return '';
  return process.env[meta.envKeyVar] || '';
}

export function getConfiguredProviders(
  providerKeys: Record<string, string>,
): string[] {
  return Object.keys(PROVIDERS).filter(name => {
    const meta = PROVIDERS[name];
    if (!meta.requiresApiKey) return true;
    if (providerKeys[name]?.trim()) return true;
    if (meta.envKeyVar && process.env[meta.envKeyVar]) return true;
    return false;
  });
}

/**
 * Normalize a base URL for OpenAI-compatible local providers.
 *
 * LM Studio and Ollama expose their OpenAI-compatible REST API under
 * `/v1/...`. Users commonly paste the server root (e.g.
 * `http://192.168.4.79:1234`) without the `/v1` suffix, which produces
 * a confusing 404 on the first request. Auto-append it when safe.
 *
 * Leaves URLs alone if they already contain a path segment (e.g. /v1,
 * /api/v1, etc.), or if the provider isn't an OpenAI-compat local one.
 */
export function normalizeBaseUrl(providerName: string, baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return baseUrl;
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;

  const isLocalCompat =
    providerName === 'openclaw' ||
    providerName === 'lmstudio' ||
    providerName === 'ollama';
  if (!isLocalCompat) return trimmed;

  // Already has a path (anything after the host)?
  try {
    const url = new URL(trimmed);
    // url.pathname is "/" for bare host, "/v1" for host+/v1, etc.
    if (url.pathname && url.pathname !== '/') {
      return trimmed;
    }
    // No path → append /v1
    return `${trimmed}/v1`;
  } catch {
    return trimmed;
  }
}
