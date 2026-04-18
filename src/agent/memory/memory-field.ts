import type { FieldKind, MemoryEntry, FieldJSON, RecallHit } from './memory-entry';
import { encodeEntry, score, type SparseState } from './encoding';

const DEFAULT_MAX_ENTRIES = 500;

function newId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface CacheEntry {
  entry: MemoryEntry;
  state: SparseState | null;
}

export class MemoryField {
  private items = new Map<string, CacheEntry>();

  constructor(
    public readonly kind: FieldKind,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  add(partial: Omit<MemoryEntry, 'id' | 'createdAt' | 'accessCount'> & { id?: string; createdAt?: number; accessCount?: number }): MemoryEntry {
    const entry: MemoryEntry = {
      id: partial.id ?? newId(),
      title: partial.title,
      body: partial.body,
      tags: partial.tags ?? [],
      createdAt: partial.createdAt ?? Date.now(),
      accessCount: partial.accessCount ?? 0,
      strength: partial.strength,
      sourceField: partial.sourceField,
      originalId: partial.originalId,
    };
    this.items.set(entry.id, { entry, state: null });
    this.evictIfOverCap();
    return entry;
  }

  get(id: string): MemoryEntry | undefined {
    return this.items.get(id)?.entry;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  size(): number {
    return this.items.size;
  }

  list(limit = 20): MemoryEntry[] {
    return [...this.items.values()]
      .map(v => v.entry)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  all(): MemoryEntry[] {
    return [...this.items.values()].map(v => v.entry);
  }

  async recall(query: string, k = 5): Promise<RecallHit[]> {
    if (this.items.size === 0) return [];
    const queryState = await encodeEntry(query, []);
    const hits: RecallHit[] = [];
    for (const cached of this.items.values()) {
      if (!cached.state) cached.state = await encodeEntry(cached.entry.body, cached.entry.tags);
      const s = score(queryState, cached.state) * Math.max(0.1, cached.entry.strength);
      hits.push({ entry: cached.entry, score: s, scope: this.kind });
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, k);
    for (const h of top) h.entry.accessCount += 1;
    return top;
  }

  /** Look up by a title+body fingerprint (for promotion dedup). */
  findByFingerprint(title: string, body: string): MemoryEntry | undefined {
    for (const { entry } of this.items.values()) {
      if (entry.title === title && entry.body === body) return entry;
    }
    return undefined;
  }

  /** Deep-copy all entries into a new field of the given kind. */
  cloneInto(kind: FieldKind): MemoryField {
    const next = new MemoryField(kind, this.maxEntries);
    for (const { entry } of this.items.values()) {
      next.items.set(entry.id, { entry: { ...entry, tags: [...entry.tags] }, state: null });
    }
    return next;
  }

  toJSON(): FieldJSON {
    return {
      kind: this.kind,
      version: 1,
      entries: this.all().map(e => ({ ...e, tags: [...e.tags] })),
    };
  }

  static fromJSON(json: FieldJSON, maxEntries = DEFAULT_MAX_ENTRIES): MemoryField {
    const field = new MemoryField(json.kind, maxEntries);
    for (const e of json.entries) field.items.set(e.id, { entry: e, state: null });
    return field;
  }

  private evictIfOverCap(): void {
    if (this.items.size <= this.maxEntries) return;
    let worstId: string | null = null;
    let worstRank = Infinity;
    for (const [id, { entry }] of this.items) {
      const rank = entry.strength * Math.log(entry.accessCount + 1 + 1);
      if (rank < worstRank) {
        worstRank = rank;
        worstId = id;
      }
    }
    if (worstId) this.items.delete(worstId);
  }
}
