import type { ModelPricing } from '@sschepis/lmscript';

export const DEFAULT_MODEL_PRICING: ModelPricing = {
  'claude-sonnet-4-20250514': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-opus-4-20250514': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-haiku-4-5-20251001': { inputPer1k: 0.001, outputPer1k: 0.005 },
  'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
  'gemini-2.0-flash': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
  'deepseek-chat': { inputPer1k: 0.00014, outputPer1k: 0.00028 },
  'deepseek-coder': { inputPer1k: 0.00014, outputPer1k: 0.00028 },
};

export { SYSTEM_PROMPT as DEFAULT_SYSTEM_PROMPT } from '../prompts/system';

export const DEFAULT_MAX_ITERATIONS = 50;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
export const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
export const DEFAULT_COMPACTION_THRESHOLD = 150_000;
export const DEFAULT_PRESERVE_RECENT_MESSAGES = 10;
