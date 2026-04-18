import { encode, initEncoder } from '../memory/encoding';
import type { AgentSyncMetrics } from '../../shared/message-types';
import { logger } from '../../shared/logger';

export type SyncUpdateCallback = (metrics: AgentSyncMetrics[]) => void;

// ── Dynamic ESM import (same pattern as encoding.ts) ─────────────────

const esmImport: (specifier: string) => Promise<unknown> =
  new Function('s', 'return import(s)') as any;

interface OscillatorLike {
  phase: number;
  amplitude: number;
  freq: number;
  excite(amount: number): void;
}

interface KuramotoLike {
  oscillators: OscillatorLike[];
  primeList: number[];
  excite(primes: number[], amount?: number): void;
  exciteByIndices(indices: number[], amount?: number): void;
  step(dt: number): void;
  orderParameter(): number;
}

interface TinyalephMod {
  KuramotoModel: new (sizeOrFreqs: number | number[], coupling?: number) => KuramotoLike;
}

let tinyalephMod: TinyalephMod | null = null;

async function loadKuramoto(): Promise<TinyalephMod> {
  if (tinyalephMod) return tinyalephMod;
  try {
    tinyalephMod = (await import(/* webpackIgnore: true */ '@aleph-ai/tinyaleph')) as TinyalephMod;
  } catch {
    tinyalephMod = (await esmImport('@aleph-ai/tinyaleph')) as TinyalephMod;
  }
  return tinyalephMod;
}

// ── Cross-sync metric ────────────────────────────────────────────────

const NUM_OSCILLATORS = 256;
const AMPLITUDE_THRESHOLD = 0.1;
const DEBOUNCE_MS = 2000;
const EXCITATION_AMOUNT = 0.5;
const STEP_DT = 0.1;

/**
 * Cross-agent sync via cosine similarity of oscillator amplitude vectors.
 * Measures whether two agents are exciting the same oscillators, weighted by
 * excitation intensity. The Kuramoto step dynamics provide temporal smoothing:
 * amplitudes decay (0.02/dt) so only recent activity contributes, and
 * oscillators reinforced across multiple ingestions maintain higher amplitude.
 */
export function crossSync(modelA: KuramotoLike, modelB: KuramotoLike): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(modelA.oscillators.length, modelB.oscillators.length);
  for (let i = 0; i < len; i++) {
    const a = modelA.oscillators[i].amplitude;
    const b = modelB.oscillators[i].amplitude;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

// ── AgentSyncMonitor ─────────────────────────────────────────────────

export class AgentSyncMonitor {
  private models = new Map<string, KuramotoLike>();
  private onSyncUpdate: SyncUpdateCallback;
  private debounceTimer?: NodeJS.Timeout;
  private disposed = false;
  private KuramotoModel: TinyalephMod['KuramotoModel'];

  private constructor(mod: TinyalephMod, onSyncUpdate: SyncUpdateCallback) {
    this.KuramotoModel = mod.KuramotoModel;
    this.onSyncUpdate = onSyncUpdate;
  }

  static async create(onSyncUpdate: SyncUpdateCallback): Promise<AgentSyncMonitor> {
    await initEncoder();
    const mod = await loadKuramoto();
    return new AgentSyncMonitor(mod, onSyncUpdate);
  }

  registerAgent(agentId: string): void {
    if (this.disposed) return;
    if (this.models.has(agentId)) return;
    this.models.set(agentId, new this.KuramotoModel(NUM_OSCILLATORS, 0.3));
  }

  unregisterAgent(agentId: string): void {
    const had = this.models.delete(agentId);
    if (had) this.computeAndBroadcast();
  }

  ingestContent(agentId: string, text: string): void {
    if (this.disposed) return;
    const model = this.models.get(agentId);
    if (!model) return;

    try {
      const state = encode(text);
      const activePrimes = state.getActivePrimes();
      if (activePrimes.length === 0) return;

      // Map encoded primes (from 4096-prime space) into oscillator indices
      // via modulo. This ensures any prime lands on a valid oscillator.
      const indices = new Set(activePrimes.map(p => p % NUM_OSCILLATORS));
      model.exciteByIndices([...indices], EXCITATION_AMOUNT);
      model.step(STEP_DT);
      this.scheduleSyncBroadcast();
    } catch (err) {
      logger.warn(`Sync ingest failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private scheduleSyncBroadcast(): void {
    if (this.disposed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.computeAndBroadcast(), DEBOUNCE_MS);
  }

  private computeAndBroadcast(): void {
    if (this.disposed) return;
    const ids = [...this.models.keys()];
    if (ids.length < 2) {
      this.onSyncUpdate([]);
      return;
    }

    const pairScoresMap = new Map<string, Record<string, number>>();
    for (const id of ids) pairScoresMap.set(id, {});

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const modelA = this.models.get(a)!;
        const modelB = this.models.get(b)!;
        const score = crossSync(modelA, modelB);
        pairScoresMap.get(a)![b] = score;
        pairScoresMap.get(b)![a] = score;
      }
    }

    const metrics: AgentSyncMetrics[] = ids.map(id => {
      const pairs = pairScoresMap.get(id)!;
      const scores = Object.values(pairs);
      return {
        agentId: id,
        syncScore: scores.length > 0 ? Math.max(...scores) : 0,
        pairScores: pairs,
      };
    });

    this.onSyncUpdate(metrics);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.models.clear();
  }
}
