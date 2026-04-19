import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Session } from '@sschepis/as-agent';
import { SESSION_AUTO_SAVE_DEBOUNCE_MS } from '../shared/constants';

const LAST_WINDOW_ID_KEY = 'clodcode.lastWindowId';
const LEGACY_FILE = 'current.json';

export interface SessionStoreOptions {
  windowId: string;
  workspaceState: vscode.Memento;
}

export interface PanelMeta {
  panelId: string;
  label: string;
  createdAt: number;
  lastActiveAt: number;
}

/**
 * Persists agent sessions to the extension's globalStorageUri.
 * Each workspace gets its own session directory. Within that, each VS Code
 * window saves to `<windowId>.json` so two concurrent windows on the same
 * workspace don't clobber each other's conversation.
 *
 * On `load()`, if no file exists for this window, we fall back to the
 * `lastWindowId` recorded in `workspaceState` so a reloaded window still
 * resumes the prior conversation. If that's absent too, we adopt a legacy
 * `current.json` (one-time migration from the pre-multi-window layout).
 */
export class SessionStore {
  private storageDir: string;
  private saveTimer?: NodeJS.Timeout;
  private readonly windowId: string;
  private readonly workspaceState: vscode.Memento;

  constructor(globalStorageUri: vscode.Uri, opts: SessionStoreOptions) {
    const workspaceId = this.getWorkspaceId();
    this.storageDir = path.join(globalStorageUri.fsPath, 'sessions', workspaceId);
    this.windowId = opts.windowId;
    this.workspaceState = opts.workspaceState;
  }

  /** Save the current session (debounced). */
  scheduleSave(session: Session): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save(session).catch(err => {
        console.warn('[clodcode] Session save failed:', err);
      });
    }, SESSION_AUTO_SAVE_DEBOUNCE_MS);
  }

  /** Save session immediately. */
  async save(session: Session): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.storageDir, `${this.windowId}.json`);
    const uri = vscode.Uri.file(filePath);
    const data = JSON.stringify(session, null, 2);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(data));
    // Remember which window most recently saved — used as the adoption
    // heuristic on next `load()` when that window's own file is absent.
    try {
      await this.workspaceState.update(LAST_WINDOW_ID_KEY, this.windowId);
    } catch {
      // Memento updates shouldn't fail, but if they do it's non-fatal.
    }
  }

  /** Load the most recent session, or return undefined. */
  async load(): Promise<Session | undefined> {
    // 1. This window's own prior save (covers reloads of the same window).
    const mine = await this.tryRead(path.join(this.storageDir, `${this.windowId}.json`));
    if (mine) return mine;

    // 2. Adoption heuristic: the window that most recently saved.
    const lastId = this.workspaceState.get<string>(LAST_WINDOW_ID_KEY);
    if (lastId && lastId !== this.windowId) {
      const adopted = await this.tryRead(path.join(this.storageDir, `${lastId}.json`));
      if (adopted) return adopted;
    }

    // 3. One-time legacy migration: the pre-multi-window layout used a fixed
    //    `current.json`. Adopt it and let the first `save()` rewrite under
    //    the new windowId-keyed path.
    const legacyPath = path.join(this.storageDir, LEGACY_FILE);
    const legacy = await this.tryRead(legacyPath);
    if (legacy) {
      try { await vscode.workspace.fs.delete(vscode.Uri.file(legacyPath)); } catch { /* ignore */ }
      return legacy;
    }

    return undefined;
  }

  /** Archive the current session with a timestamp. */
  async archive(session: Session): Promise<void> {
    await this.ensureDir();
    const historyDir = path.join(this.storageDir, 'history');
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(historyDir));
    } catch { /* may exist */ }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(historyDir, `${timestamp}.json`);
    const data = JSON.stringify(session, null, 2);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(data));
  }

  /** Return the directory where sessions + archives for this workspace live. */
  getStorageDir(): string { return this.storageDir; }

  /** Return the current window's session file path (may not exist yet). */
  getCurrentSessionPath(): string {
    return path.join(this.storageDir, `${this.windowId}.json`);
  }

  /** Return this window's id. */
  getWindowId(): string { return this.windowId; }

  /** List archived sessions (newest first). */
  async listArchives(): Promise<string[]> {
    const historyDir = path.join(this.storageDir, 'history');
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(historyDir));
      return entries
        .filter(([name]) => name.endsWith('.json'))
        .map(([name]) => name.replace('.json', ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /** Load an archived session by timestamp name. */
  async loadArchive(name: string): Promise<Session | undefined> {
    return this.tryRead(path.join(this.storageDir, 'history', `${name}.json`));
  }

  /** Save the conversation memory field for the foreground agent, alongside the session. */
  async saveMemory(memoryJson: unknown): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.storageDir, `${this.windowId}.memory.json`);
    const data = JSON.stringify(memoryJson, null, 2);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(data));
  }

  /** Load the conversation memory field saved alongside the session. */
  async loadMemory(): Promise<unknown | undefined> {
    // Try this window's memory file first, then the adoption source's.
    const myPath = path.join(this.storageDir, `${this.windowId}.memory.json`);
    const mine = await this.tryReadJson(myPath);
    if (mine) return mine;
    const lastId = this.workspaceState.get<string>(LAST_WINDOW_ID_KEY);
    if (lastId && lastId !== this.windowId) {
      return await this.tryReadJson(path.join(this.storageDir, `${lastId}.memory.json`));
    }
    return undefined;
  }

  // ── Per-panel session persistence ────────────────────────────────────

  private panelSaveTimers = new Map<string, NodeJS.Timeout>();

  scheduleSavePanel(panelId: string, session: Session): void {
    const existing = this.panelSaveTimers.get(panelId);
    if (existing) clearTimeout(existing);
    this.panelSaveTimers.set(panelId, setTimeout(() => {
      this.savePanel(panelId, session).catch(err => {
        console.warn(`[clodcode] Panel session save failed for ${panelId}:`, err);
      });
    }, SESSION_AUTO_SAVE_DEBOUNCE_MS));
  }

  async savePanel(panelId: string, session: Session): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.storageDir, `${panelId}.json`);
    const data = JSON.stringify(session, null, 2);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(data));
  }

  async loadPanel(panelId: string): Promise<Session | undefined> {
    return this.tryRead(path.join(this.storageDir, `${panelId}.json`));
  }

  async savePanelMemory(panelId: string, memoryJson: unknown): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.storageDir, `${panelId}.memory.json`);
    const data = JSON.stringify(memoryJson, null, 2);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(data));
  }

  async loadPanelMemory(panelId: string): Promise<unknown | undefined> {
    return this.tryReadJson(path.join(this.storageDir, `${panelId}.memory.json`));
  }

  async deletePanel(panelId: string): Promise<void> {
    for (const suffix of ['.json', '.memory.json']) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(this.storageDir, `${panelId}${suffix}`)));
      } catch { /* may not exist */ }
    }
  }

  async savePanelIndex(panels: PanelMeta[]): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.storageDir, 'panels.json');
    const data = JSON.stringify(panels, null, 2);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(data));
  }

  async loadPanelIndex(): Promise<PanelMeta[]> {
    try {
      const data = await vscode.workspace.fs.readFile(
        vscode.Uri.file(path.join(this.storageDir, 'panels.json'))
      );
      return JSON.parse(new TextDecoder().decode(data)) as PanelMeta[];
    } catch {
      return [];
    }
  }

  // ── UI events persistence ──────────────────────────────────────────

  async saveUiEvents(events: unknown[]): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.storageDir, `${this.windowId}.events.json`);
    const data = JSON.stringify(events);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(data));
  }

  async loadUiEvents(): Promise<unknown[] | undefined> {
    const myPath = path.join(this.storageDir, `${this.windowId}.events.json`);
    const mine = await this.tryReadJson(myPath) as unknown[] | undefined;
    if (mine) return mine;
    const lastId = this.workspaceState.get<string>(LAST_WINDOW_ID_KEY);
    if (lastId && lastId !== this.windowId) {
      return await this.tryReadJson(path.join(this.storageDir, `${lastId}.events.json`)) as unknown[] | undefined;
    }
    return undefined;
  }

  async savePanelUiEvents(panelId: string, events: unknown[]): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.storageDir, `${panelId}.events.json`);
    const data = JSON.stringify(events);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(data));
  }

  async loadPanelUiEvents(panelId: string): Promise<unknown[] | undefined> {
    return this.tryReadJson(path.join(this.storageDir, `${panelId}.events.json`)) as Promise<unknown[] | undefined>;
  }

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const timer of this.panelSaveTimers.values()) clearTimeout(timer);
    this.panelSaveTimers.clear();
  }

  private async tryRead(filePath: string): Promise<Session | undefined> {
    try {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(new TextDecoder().decode(data)) as Session;
    } catch {
      return undefined;
    }
  }

  private async tryReadJson(filePath: string): Promise<unknown | undefined> {
    try {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(new TextDecoder().decode(data));
    } catch {
      return undefined;
    }
  }

  private async ensureDir(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(this.storageDir));
    } catch { /* may exist */ }
  }

  private getWorkspaceId(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return 'default';
    const hash = crypto.createHash('sha256').update(folders[0].uri.fsPath).digest('hex');
    return hash.slice(0, 12);
  }
}
