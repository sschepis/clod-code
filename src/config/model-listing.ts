import { PROVIDER_MODEL_SUGGESTIONS } from './model-inference';
import { PROVIDERS, getConfiguredProviders } from './provider-registry';
import type { PickerProviderInfo } from '../shared/message-types';

export async function getProviderModels(
  providerKeys: Record<string, string>,
): Promise<PickerProviderInfo[]> {
  const configured = new Set(getConfiguredProviders(providerKeys));

  const results: PickerProviderInfo[] = [];

  for (const [name, meta] of Object.entries(PROVIDERS)) {
    const isConfigured = configured.has(name);
    let models = PROVIDER_MODEL_SUGGESTIONS[name] ?? [];

    if (name === 'ollama' && isConfigured) {
      try {
        const dynamic = await listOllamaModels(meta.defaultBaseUrl);
        if (dynamic.length > 0) models = dynamic;
      } catch { /* fall back to static */ }
    }

    results.push({
      name: meta.name,
      displayName: meta.displayName,
      isLocal: meta.isLocal,
      configured: isConfigured,
      models,
    });
  }

  results.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return results;
}

async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const root = (baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const url = `${root}/api/tags`;
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) return [];
  const data = await response.json() as { models?: Array<{ name: string }> };
  return (data.models ?? []).map(m => m.name);
}
