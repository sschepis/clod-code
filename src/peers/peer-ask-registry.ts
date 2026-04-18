import * as crypto from 'crypto';

export type PeerAskStatus = 'pending' | 'answered' | 'cancelled' | 'rejected';

export interface PeerAskRecord {
  rpcId: string;
  fromWindowId: string;
  question: string;
  choices: string[];
  defaultChoice?: number;
  inputMode: 'choice' | 'text';
  status: PeerAskStatus;
  answerIndex?: number;
  answerText?: string;
  reason?: string;
  createdAt: number;
  completedAt?: number;
}

/**
 * In-memory registry of questions that peers have asked of THIS window's user.
 * Entries live for 10 minutes past completion so the asking peer has time to
 * collect the answer.
 */
export class PeerAskRegistry {
  private records = new Map<string, PeerAskRecord>();
  private readonly retentionMs = 10 * 60 * 1000;
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  create(input: {
    fromWindowId: string;
    question: string;
    choices: string[];
    defaultChoice?: number;
    inputMode?: 'choice' | 'text';
  }): PeerAskRecord {
    const rec: PeerAskRecord = {
      rpcId: crypto.randomUUID(),
      fromWindowId: input.fromWindowId,
      question: input.question,
      choices: input.choices,
      defaultChoice: input.defaultChoice,
      inputMode: input.inputMode ?? 'choice',
      status: 'pending',
      createdAt: Date.now(),
    };
    this.records.set(rec.rpcId, rec);
    return rec;
  }

  get(rpcId: string): PeerAskRecord | undefined {
    return this.records.get(rpcId);
  }

  has(rpcId: string): boolean {
    return this.records.has(rpcId);
  }

  update(rpcId: string, patch: Partial<PeerAskRecord>): PeerAskRecord | undefined {
    const rec = this.records.get(rpcId);
    if (!rec) return undefined;
    Object.assign(rec, patch);
    return rec;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    for (const [rpcId, rec] of this.records) {
      if (rec.status !== 'pending' && rec.completedAt && rec.completedAt < cutoff) {
        this.records.delete(rpcId);
      }
    }
  }
}
