import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { MemoryField } from './memory-field';
import { initEncoder } from './encoding';
import type { FieldJSON, FieldKind, MemoryEntry, RecallHit } from './memory-entry';
import { logger } from '../../shared/logger';

export type RecallScope = 'conversation' | 'project' | 'global' | 'all';

export class MemoryManager {
  private global: MemoryField;
  private project: MemoryField;
  private conversations = new Map<string, MemoryField>();
  private readonly globalPath: string;
  private readonly projectPath: string;
  private flushTimer?: NodeJS.Timeout;
  private changeListeners = new Set<() => void>();

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.global = new MemoryField('global');
    this.project = new MemoryField('project');
    const base = path.join(ctx.globalStorageUri.fsPath, 'memory');
    this.globalPath = path.join(base, 'global.json');
    this.projectPath = path.join(base, 'projects', `${this.workspaceId()}.json`);
  }

  /** Subscribe to change notifications. Returns an unsubscribe fn. */
  onDidChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const l of this.changeListeners) {
      try { l(); } catch (err) {
        logger.warn('Memory change listener threw', err);
      }
    }
  }

  async init(): Promise<void> {
    await initEncoder();
    await this.ensureDir(path.dirname(this.globalPath));
    await this.ensureDir(path.dirname(this.projectPath));
    this.global = await this.loadField(this.globalPath, 'global');
    this.project = await this.loadField(this.projectPath, 'project');
    logger.info(
      `Memory loaded: global=${this.global.size()} project=${this.project.size()} (workspace=${this.workspaceId()})`,
    );
  }

  getConversation(agentId: string): MemoryField {
    let f = this.conversations.get(agentId);
    if (!f) {
      f = new MemoryField('conversation');
      this.conversations.set(agentId, f);
    }
    return f;
  }

  getProject(): MemoryField { return this.project; }
  getGlobal(): MemoryField { return this.global; }

  getGlobalPath(): string { return this.globalPath; }
  getProjectPath(): string { return this.projectPath; }

  snapshotForSpawn(parentAgentId: string, childAgentId: string): void {
    const parent = this.conversations.get(parentAgentId);
    const clone = parent ? parent.cloneInto('conversation') : new MemoryField('conversation');
    this.conversations.set(childAgentId, clone);
    this.emitChange();
  }

  disposeConversation(agentId: string): void {
    const had = this.conversations.delete(agentId);
    if (had) this.emitChange();
  }

  serializeConversation(agentId: string): FieldJSON | undefined {
    const f = this.conversations.get(agentId);
    return f?.toJSON();
  }

  loadConversation(agentId: string, json: FieldJSON | undefined): void {
    if (!json) return;
    this.conversations.set(agentId, MemoryField.fromJSON(json));
    this.emitChange();
  }

  promote(agentId: string, entryId: string, to: 'project' | 'global'): MemoryEntry | undefined {
    const source = this.findContaining(agentId, entryId);
    if (!source) return undefined;
    const entry = source.field.get(entryId);
    if (!entry) return undefined;

    const target = to === 'project' ? this.project : this.global;
    const existing = target.findByFingerprint(entry.title, entry.body);
    if (existing) {
      existing.strength = Math.max(existing.strength, entry.strength);
      existing.accessCount += 1;
      this.scheduleFlush();
      return existing;
    }

    const promoted = target.add({
      title: entry.title,
      body: entry.body,
      tags: [...entry.tags],
      strength: Math.max(entry.strength, 0.5),
      sourceField: source.field.kind,
      originalId: entry.id,
    });
    this.scheduleFlush();
    this.emitChange();
    return promoted;
  }

  async recall(agentId: string, query: string, scope: RecallScope = 'all', k = 5): Promise<RecallHit[]> {
    const fields: MemoryField[] = [];
    if (scope === 'conversation' || scope === 'all') fields.push(this.getConversation(agentId));
    if (scope === 'project' || scope === 'all') fields.push(this.project);
    if (scope === 'global' || scope === 'all') fields.push(this.global);

    const hits: RecallHit[] = [];
    for (const f of fields) hits.push(...(await f.recall(query, k)));
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /**
   * Add an entry to the conversation field and emit change. Used by both the
   * `memory/add` tool and the orchestrator's tool_complete auto-capture so
   * the Object Manager can react to new entries.
   */
  recordConversationEntry(agentId: string, partial: Parameters<MemoryField['add']>[0]): MemoryEntry {
    const entry = this.getConversation(agentId).add(partial);
    this.emitChange();
    return entry;
  }

  list(agentId: string, scope: 'conversation' | 'project' | 'global', k = 20): MemoryEntry[] {
    const f = scope === 'conversation' ? this.getConversation(agentId)
            : scope === 'project'      ? this.project
            :                            this.global;
    return f.list(k);
  }

  remove(agentId: string, entryId: string): boolean {
    const found = this.findContaining(agentId, entryId);
    if (!found) return false;
    const ok = found.field.remove(entryId);
    if (ok) {
      if (found.field.kind !== 'conversation') this.scheduleFlush();
      this.emitChange();
    }
    return ok;
  }

  scheduleFlush(delayMs = 2000): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { void this.flushDurable(); }, delayMs);
  }

  async flushDurable(): Promise<void> {
    try {
      await this.writeAtomic(this.globalPath, JSON.stringify(this.global.toJSON()));
      await this.writeAtomic(this.projectPath, JSON.stringify(this.project.toJSON()));
    } catch (err) {
      logger.warn(`Memory flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flushDurable();
  }

  private findContaining(agentId: string, entryId: string): { field: MemoryField } | undefined {
    const conv = this.getConversation(agentId);
    if (conv.get(entryId)) return { field: conv };
    if (this.project.get(entryId)) return { field: this.project };
    if (this.global.get(entryId)) return { field: this.global };
    return undefined;
  }

  private async loadField(filePath: string, kind: FieldKind): Promise<MemoryField> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const json = JSON.parse(new TextDecoder().decode(bytes)) as FieldJSON;
      if (json.kind !== kind || json.version !== 1) {
        logger.warn(`Memory file ${filePath} has unexpected kind/version; starting fresh.`);
        return new MemoryField(kind);
      }
      return MemoryField.fromJSON(json);
    } catch {
      return new MemoryField(kind);
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir)); } catch { /* exists */ }
  }

  private async writeAtomic(target: string, contents: string): Promise<void> {
    const tmp = `${target}.tmp`;
    const bytes = new TextEncoder().encode(contents);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(tmp), bytes);
    await vscode.workspace.fs.rename(vscode.Uri.file(tmp), vscode.Uri.file(target), { overwrite: true });
  }

  private workspaceId(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return 'default';
    const hash = crypto.createHash('sha256').update(folders[0].uri.fsPath).digest('hex');
    return hash.slice(0, 12);
  }
}
