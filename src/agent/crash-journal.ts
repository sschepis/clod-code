import * as vscode from 'vscode';
import * as path from 'path';
import type { Session } from '@sschepis/as-agent';

export interface SerializedSpawnOpts {
  task: string;
  systemPrompt?: string;
  model?: { provider?: string; name?: string };
  budgetUsd?: number;
  timeoutMs?: number;
  permissionMode?: string;
  parentId?: string;
  label?: string;
  batchId?: string;
  role?: string;
}

export interface CrashJournalEntry {
  agentId: string;
  createdAt: string;
  updatedAt: string;
  spawnOpts: SerializedSpawnOpts;
  phase: 'running' | 'complete';
  inFlightTool: string | null;
  budgetUsd: number;
  spentUsd: number;
  spentByChildren: number;
  lineage: string[];
  parentId?: string;
  batchId?: string;
}

const JOURNAL_SUFFIX = '.journal.json';
const SESSION_SUFFIX = '.session.json';
const EVENTS_SUFFIX = '.events.json';

export class CrashJournalManager {
  private readonly agentsDir: string;
  private pendingToolUpdate?: NodeJS.Timeout;
  private pendingSessionSave?: NodeJS.Timeout;
  private journals = new Map<string, CrashJournalEntry>();

  constructor(baseStorageDir: string) {
    this.agentsDir = path.join(baseStorageDir, 'agents');
  }

  async writeJournal(entry: CrashJournalEntry): Promise<void> {
    await this.ensureDir();
    entry.updatedAt = new Date().toISOString();
    this.journals.set(entry.agentId, entry);
    await this.atomicWrite(
      path.join(this.agentsDir, `${entry.agentId}${JOURNAL_SUFFIX}`),
      JSON.stringify(entry, null, 2),
    );
  }

  async saveAgentSession(agentId: string, session: Session): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.agentsDir, `${agentId}${SESSION_SUFFIX}`);
    await this.atomicWrite(filePath, JSON.stringify(session));
  }

  async saveAgentEvents(agentId: string, events: unknown[]): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.agentsDir, `${agentId}${EVENTS_SUFFIX}`);
    await this.atomicWrite(filePath, JSON.stringify(events));
  }

  async updateInFlightTool(agentId: string, tool: string | null): Promise<void> {
    const entry = this.journals.get(agentId);
    if (!entry) return;
    entry.inFlightTool = tool;
    entry.updatedAt = new Date().toISOString();
    await this.atomicWrite(
      path.join(this.agentsDir, `${entry.agentId}${JOURNAL_SUFFIX}`),
      JSON.stringify(entry, null, 2),
    );
  }

  async updateSpent(agentId: string, spentUsd: number, spentByChildren: number): Promise<void> {
    const entry = this.journals.get(agentId);
    if (!entry) return;
    entry.spentUsd = spentUsd;
    entry.spentByChildren = spentByChildren;
    entry.updatedAt = new Date().toISOString();
    await this.atomicWrite(
      path.join(this.agentsDir, `${entry.agentId}${JOURNAL_SUFFIX}`),
      JSON.stringify(entry, null, 2),
    );
  }

  async markComplete(agentId: string): Promise<void> {
    this.journals.delete(agentId);
    const base = path.join(this.agentsDir, agentId);
    await this.tryDelete(`${base}${JOURNAL_SUFFIX}`);
    await this.tryDelete(`${base}${SESSION_SUFFIX}`);
    await this.tryDelete(`${base}${EVENTS_SUFFIX}`);
  }

  async removeJournal(agentId: string): Promise<void> {
    this.journals.delete(agentId);
    await this.markComplete(agentId);
  }

  async loadJournal(agentId: string): Promise<CrashJournalEntry | undefined> {
    const filePath = path.join(this.agentsDir, `${agentId}${JOURNAL_SUFFIX}`);
    return this.tryReadJson<CrashJournalEntry>(filePath);
  }

  async loadAgentSession(agentId: string): Promise<Session | undefined> {
    const filePath = path.join(this.agentsDir, `${agentId}${SESSION_SUFFIX}`);
    return this.tryReadJson<Session>(filePath);
  }

  async loadAgentEvents(agentId: string): Promise<unknown[] | undefined> {
    const filePath = path.join(this.agentsDir, `${agentId}${EVENTS_SUFFIX}`);
    const data = await this.tryReadJson<unknown[]>(filePath);
    return Array.isArray(data) ? data : undefined;
  }

  async findInterruptedAgents(): Promise<CrashJournalEntry[]> {
    const results: CrashJournalEntry[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.agentsDir));
      for (const [name] of entries) {
        if (!name.endsWith(JOURNAL_SUFFIX)) continue;
        const filePath = path.join(this.agentsDir, name);
        const journal = await this.tryReadJson<CrashJournalEntry>(filePath);
        if (journal && journal.phase === 'running') {
          results.push(journal);
        }
      }
    } catch {
      // Directory may not exist — no interrupted agents
    }
    return results;
  }

  async clearAll(): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.agentsDir));
      for (const [name] of entries) {
        await this.tryDelete(path.join(this.agentsDir, name));
      }
    } catch {
      // Directory may not exist
    }
    this.journals.clear();
  }

  dispose(): void {
    if (this.pendingToolUpdate) clearTimeout(this.pendingToolUpdate);
    if (this.pendingSessionSave) clearTimeout(this.pendingSessionSave);
  }

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    const encoded = new TextEncoder().encode(data);
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(tmpPath), encoded);
      await vscode.workspace.fs.rename(
        vscode.Uri.file(tmpPath),
        vscode.Uri.file(filePath),
        { overwrite: true },
      );
    } catch {
      // Fallback: direct write if rename fails (e.g., cross-device)
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), encoded);
      await this.tryDelete(tmpPath);
    }
  }

  private async tryDelete(filePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
    } catch { /* ignore */ }
  }

  private async tryReadJson<T>(filePath: string): Promise<T | undefined> {
    try {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(new TextDecoder().decode(data)) as T;
    } catch {
      return undefined;
    }
  }

  private async ensureDir(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(this.agentsDir));
    } catch { /* may exist */ }
  }
}
