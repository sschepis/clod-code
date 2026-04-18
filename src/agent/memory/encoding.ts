import { pipeline } from '@xenova/transformers';

let extractor: any = null;

export async function initEncoder(): Promise<void> {
  if (extractor) return;
  // Initialize the feature extraction pipeline.
  extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });
}

export async function encodeEntry(text: string, tags: string[] = []): Promise<number[]> {
  if (!extractor) await initEncoder();
  
  const content = text + (tags.length ? ' ' + tags.join(' ') : '');
  const output = await extractor(content, { pooling: 'mean', normalize: true });
  
  return Array.from(output.data);
}

export function score(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return Math.max(0, Math.min(1, dotProduct));
}

export type SparseState = number[];
