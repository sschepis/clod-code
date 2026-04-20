import { PROVIDERS, getConfiguredProviders } from './provider-registry';
import { ENV_KEY_MAP } from '../shared/constants';
import type { PickerProviderInfo } from '../shared/message-types';
import { logger } from '../shared/logger';

import type { ObotovsSettings, ProviderConfig } from './settings';
import { getManagedProviderStatus, MANAGED_PROVIDER_ID, RECOMMENDED_MANAGED_MODELS } from './managed-provider';

export async function getProviderModels(
  settings: ObotovsSettings,
): Promise<PickerProviderInfo[]> {
  const results: PickerProviderInfo[] = [];
  const configuredTypes = new Set<string>();

  // 1. Add explicitly configured providers
  const fetches = Object.entries(settings.providers).map(async ([id, config]) => {
    const meta = PROVIDERS[config.type];
    if (!meta) return null;
    configuredTypes.add(config.type);

    let models: string[] = [];
    try {
      const apiKey = config.apiKey || process.env[meta.envKeyVar];
      const baseUrl = config.baseUrl || meta.defaultBaseUrl;
      models = await listModelsForProvider(config.type, apiKey, baseUrl);
      
      // If a defaultModel is set but not in the fetched list, inject it
      if (config.defaultModel && !models.includes(config.defaultModel)) {
        models.unshift(config.defaultModel);
      }
    } catch (err) {
      logger.debug(`Failed to fetch models for ${id}`, err);
    }

    return {
      name: id, // The ID of the provider instance
      displayName: config.label || `${meta.displayName} (${id})`,
      isLocal: meta.isLocal,
      configured: true,
      models,
    };
  });

  const resolved = (await Promise.all(fetches)).filter(Boolean) as PickerProviderInfo[];
  results.push(...resolved);

  // 2. Add the Managed Provider if it has a model available (or is running)
  try {
    const obotoStatus = await getManagedProviderStatus();
    if (obotoStatus.ollamaInstalled) {
      results.push({
        name: MANAGED_PROVIDER_ID,
        displayName: 'Oboto Local (Managed)',
        isLocal: true,
        configured: true,
        models: Array.from(new Set([...obotoStatus.availableModels, ...RECOMMENDED_MANAGED_MODELS])),
      });
    }
  } catch (err) {
    logger.debug('Failed to check managed provider status', err);
  }

  // 3. Add unconfigured standard providers so the user knows they exist
  for (const [type, meta] of Object.entries(PROVIDERS)) {
    if (!configuredTypes.has(type)) {
      results.push({
        name: type,
        displayName: meta.displayName,
        isLocal: meta.isLocal,
        configured: false,
        models: [],
      });
    }
  }

  results.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return results;
}

// ── Per-provider model listing ──────────────────────────────────────

export async function listModelsForProvider(
  providerType: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<string[]> {
  switch (providerType) {
    case 'ollama':
      return listOllamaModels(baseUrl);
    case 'lmstudio':
      return listOpenAICompatModels(baseUrl || 'http://localhost:1234');
    case 'openai':
      return listOpenAIModels(apiKey);
    case 'anthropic':
      return listAnthropicModels(apiKey);
    case 'gemini':
      return listGeminiModels(apiKey);
    case 'deepseek':
      return listOpenAICompatModels(baseUrl || 'https://api.deepseek.com', apiKey);
    case 'openrouter':
      return listOpenRouterModels(apiKey);
    case 'azure-openai':
      return listAzureModels(apiKey, baseUrl);
    case 'vertex-gemini':
      return listVertexGeminiModels(baseUrl);
    case 'vertex-anthropic':
      return listVertexAnthropicModels(baseUrl);
    case 'vscode-lm':
      return listVSCodeLMModels();
    default:
      return [];
  }
}

// ── Ollama ──────────────────────────────────────────────────────────

export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const root = ollamaRoot(baseUrl);
  const url = `${root}/api/tags`;
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) return [];
  const data = await response.json() as { models?: Array<{ name: string }> };
  return (data.models ?? []).map(m => m.name);
}

export async function isOllamaRunning(baseUrl?: string): Promise<boolean> {
  try {
    const root = ollamaRoot(baseUrl);
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function isOllamaModelAvailable(model: string, baseUrl?: string): Promise<boolean> {
  const models = await listOllamaModels(baseUrl);
  return models.some(m => m === model || m === `${model}:latest`);
}

export async function pullOllamaModel(
  modelName: string,
  onProgress?: (status: string, percent?: number) => void,
  baseUrl?: string,
): Promise<void> {
  const root = ollamaRoot(baseUrl);
  const response = await fetch(`${root}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to pull "${modelName}": ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        const pct = data.total ? Math.round((data.completed / data.total) * 100) : undefined;
        onProgress?.(data.status ?? 'pulling', pct);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

// ── OpenAI ──────────────────────────────────────────────────────────

async function listOpenAIModels(apiKey?: string): Promise<string[]> {
  if (!apiKey) return [];
  return listOpenAICompatModels('https://api.openai.com', apiKey);
}

// ── OpenAI-compatible (also used by DeepSeek, LM Studio) ───────────

async function listOpenAICompatModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error(`Failed to fetch models from ${url}. Status: ${res.status} ${res.statusText}
Body: ${text}`);
      return [];
    }

    const data = await res.json() as { data?: Array<{ id: string }> };
    return (data.data ?? [])
      .map(m => m.id)
      .sort();
  } catch (err) {
    logger.error(`Error fetching models from ${url}:`, err);
    return [];
  }
}

// ── Anthropic ───────────────────────────────────────────────────────

async function listAnthropicModels(apiKey?: string): Promise<string[]> {
  if (!apiKey) return [];
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];

  const data = await res.json() as { data?: Array<{ id: string }> };
  return (data.data ?? [])
    .map(m => m.id)
    .sort();
}

// ── Gemini (Google AI) ──────────────────────────────────────────────

async function listGeminiModels(apiKey?: string): Promise<string[]> {
  if (!apiKey) return [];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return [];

  const data = await res.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  return (data.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .sort();
}

// ── OpenRouter ──────────────────────────────────────────────────────

async function listOpenRouterModels(apiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];

  const data = await res.json() as { data?: Array<{ id: string }> };
  return (data.data ?? [])
    .map(m => m.id)
    .sort();
}

// ── Vertex AI ──────────────────────────────────────────────────────

async function listVertexGeminiModels(_baseUrl?: string): Promise<string[]> {
  try {
    const token = await getGcloudAccessToken();
    const project = await getGcloudProject();
    if (!token || !project) return [];

    const location = 'us-central1';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = await res.json() as { models?: Array<{ name: string; supportedActions?: string[] }> };
    return (data.models ?? [])
      .map(m => m.name.split('/').pop() ?? '')
      .filter(Boolean)
      .sort();
  } catch (err) {
    logger.debug('Failed to list Vertex Gemini models', err);
    return [];
  }
}

async function listVertexAnthropicModels(_baseUrl?: string): Promise<string[]> {
  try {
    const token = await getGcloudAccessToken();
    const project = await getGcloudProject();
    if (!token || !project) return [];

    const location = 'us-central1';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/anthropic/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = await res.json() as { models?: Array<{ name: string }> };
    return (data.models ?? [])
      .map(m => m.name.split('/').pop() ?? '')
      .filter(Boolean)
      .sort();
  } catch (err) {
    logger.debug('Failed to list Vertex Anthropic models', err);
    return [];
  }
}

async function getGcloudAccessToken(): Promise<string | null> {
  try {
    const { execFile } = await import('child_process');
    return new Promise(resolve => {
      execFile('gcloud', ['auth', 'print-access-token'], { timeout: 5000 }, (err, stdout) => {
        if (err) { resolve(null); return; }
        const token = stdout.trim();
        resolve(token || null);
      });
    });
  } catch {
    return null;
  }
}

async function getGcloudProject(): Promise<string | null> {
  try {
    const { execFile } = await import('child_process');
    return new Promise(resolve => {
      execFile('gcloud', ['config', 'get-value', 'project'], { timeout: 5000 }, (err, stdout) => {
        if (err) { resolve(null); return; }
        const project = stdout.trim();
        resolve(project && project !== '(unset)' ? project : null);
      });
    });
  } catch {
    return null;
  }
}

// ── Azure OpenAI ────────────────────────────────────────────────────

async function listAzureModels(apiKey?: string, baseUrl?: string): Promise<string[]> {
  if (!apiKey || !baseUrl) return [];
  const endpoint = baseUrl.replace(/\/+$/, '');
  const res = await fetch(
    `${endpoint}/openai/models?api-version=2024-10-21`,
    {
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) return [];

  const data = await res.json() as { data?: Array<{ id: string }> };
  return (data.data ?? [])
    .map(m => m.id)
    .sort();
}

// ── Helpers ─────────────────────────────────────────────────────────

function ollamaRoot(baseUrl?: string): string {
  return (baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
}

// ── VS Code Language Model API ────────────────────────────────────

async function listVSCodeLMModels(): Promise<string[]> {
  try {
    const vscode = await import('vscode');
    const models = await vscode.lm.selectChatModels();
    return models.map(m => m.id).sort();
  } catch {
    return [];
  }
}

function resolveKeyForListing(
  providerName: string,
  providerKeys: Record<string, string>,
): string {
  if (providerKeys[providerName]?.trim()) return providerKeys[providerName].trim();
  const envVar = ENV_KEY_MAP[providerName];
  if (envVar) return process.env[envVar] || '';
  return '';
}
