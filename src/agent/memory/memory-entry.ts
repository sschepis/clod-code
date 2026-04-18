export type FieldKind = 'global' | 'project' | 'conversation';

export interface MemoryEntry {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  accessCount: number;
  strength: number;
  sourceField?: FieldKind;
  originalId?: string;
}

export interface FieldJSON {
  kind: FieldKind;
  version: 1;
  entries: MemoryEntry[];
}

export interface RecallHit {
  entry: MemoryEntry;
  score: number;
  scope: FieldKind;
}
