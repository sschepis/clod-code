export interface QuestionResult {
  cancelled: boolean;
  index?: number;
  text?: string;
}

export interface SecretResult {
  cancelled: boolean;
  value?: string;
  saveToFile?: boolean;
}

export interface PlanApprovalResult {
  denied: boolean;
  approvalMode?: 'auto' | 'manual';
}

type Pending =
  | { kind: 'question'; resolve: (r: QuestionResult) => void }
  | { kind: 'secret'; resolve: (r: SecretResult) => void }
  | { kind: 'plan_approval'; resolve: (r: PlanApprovalResult) => void };

class UserPromptBridge {
  private pending = new Map<string, Pending>();
  private counter = 0;

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${Date.now()}-${this.counter}`;
  }

  registerQuestion(id: string): Promise<QuestionResult> {
    return new Promise((resolve) => {
      this.pending.set(id, { kind: 'question', resolve });
    });
  }

  registerSecret(id: string): Promise<SecretResult> {
    return new Promise((resolve) => {
      this.pending.set(id, { kind: 'secret', resolve });
    });
  }

  resolveQuestion(id: string, result: QuestionResult): boolean {
    const entry = this.pending.get(id);
    if (!entry || entry.kind !== 'question') return false;
    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }

  resolveSecret(id: string, result: SecretResult): boolean {
    const entry = this.pending.get(id);
    if (!entry || entry.kind !== 'secret') return false;
    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }

  registerPlanApproval(id: string): Promise<PlanApprovalResult> {
    return new Promise((resolve) => {
      this.pending.set(id, { kind: 'plan_approval', resolve });
    });
  }

  resolvePlanApproval(id: string, result: PlanApprovalResult): boolean {
    const entry = this.pending.get(id);
    if (!entry || entry.kind !== 'plan_approval') return false;
    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }

  cancelAll(): void {
    for (const [, entry] of this.pending) {
      if (entry.kind === 'question') entry.resolve({ cancelled: true });
      else if (entry.kind === 'plan_approval') entry.resolve({ denied: true });
      else entry.resolve({ cancelled: true });
    }
    this.pending.clear();
  }
}

let singleton: UserPromptBridge | null = null;

export function getUserPromptBridge(): UserPromptBridge {
  if (!singleton) singleton = new UserPromptBridge();
  return singleton;
}

export type { UserPromptBridge };
