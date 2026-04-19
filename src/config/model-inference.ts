/**
 * Map model names to providers and suggest sensible defaults.
 *
 * This exists because the settings UI has two fields (provider + model)
 * and users frequently get them out of sync (e.g. provider="anthropic"
 * but model="gemini-2.0-flash"). Matching the model to its provider lets
 * us warn the user or auto-correct the mismatch.
 */

interface ModelPattern {
  pattern: RegExp;
  provider: string;
}

const MODEL_PATTERNS: ModelPattern[] = [
  { pattern: /^claude[-_]/i, provider: 'anthropic' },
  { pattern: /^(gpt[-_]|o1[-_]?|o3[-_]?|chatgpt[-_])/i, provider: 'openai' },
  { pattern: /^gemini[-_]/i, provider: 'gemini' },
  { pattern: /^deepseek[-_]/i, provider: 'deepseek' },
  // Local model families typically run on ollama/lmstudio
  { pattern: /^(llama|qwen|mistral|mixtral|phi|codellama|starcoder|deepseek-coder|gemma|yi)/i, provider: 'ollama' },
];

/** Infer the most likely provider from a model name. Returns null if unknown. */
export function inferProviderFromModel(model: string): string | null {
  if (!model) return null;
  for (const { pattern, provider } of MODEL_PATTERNS) {
    if (pattern.test(model)) return provider;
  }
  return null;
}

/**
 * Check whether a model name looks like it belongs to the given provider.
 * Returns true for unknown patterns (so we don't block uncommon models).
 */
export function isModelCompatibleWithProvider(model: string, provider: string): boolean {
  const inferred = inferProviderFromModel(model);
  if (inferred === null) return true; // Unknown — trust the user

  // Vertex variants share the same model families as their underlying provider
  if (provider === 'vertex-gemini' && inferred === 'gemini') return true;
  if (provider === 'vertex-anthropic' && inferred === 'anthropic') return true;
  // OpenRouter/openai-compat can route to any model
  if (provider === 'openrouter') return true;
  // Azure deployments use custom names
  if (provider === 'azure-openai') return true;
  // Ollama/lmstudio can serve any local model name
  if ((provider === 'ollama' || provider === 'lmstudio') && inferred === 'ollama') return true;

  return inferred === provider;
}

