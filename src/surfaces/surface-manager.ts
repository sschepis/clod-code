import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../shared/logger';
import { SurfacePanel } from './surface-panel';
import type { SurfaceError } from './surface-panel';

export const SURFACE_NAME_RE = /^[A-Za-z0-9_-]+$/;

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

export function surfacesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.obotovs', 'surfaces');
}

export function surfaceFile(workspaceRoot: string, name: string): string {
  return path.join(surfacesDir(workspaceRoot), `${name}.html`);
}

export interface OpenResult {
  ok: boolean;
  reason?: string;
}

export interface SurfaceManagerOptions {
  /** Returns whether the AI is currently allowed to auto-open panels. */
  isAutoOpenEnabled: () => boolean;
  /** Returns the current routes server base URL, or null if not running. */
  getRoutesUrl: () => string | null;
  /** Called when a surface webview reports a JS runtime error. */
  onSurfaceError?: (error: SurfaceError) => void;
  /** Called when a surface requests to submit text to an agent. */
  onSubmitToAgent?: (text: string, agentId?: string) => void;
  /** Called when a surface requests to execute a tool. */
  onExecuteTool?: (tool: string, kwargs: Record<string, unknown>) => Promise<any>;
}

export class SurfaceManager {
  private panels = new Map<string, SurfacePanel>();
  private watcher?: vscode.FileSystemWatcher;

  constructor(private readonly opts: SurfaceManagerOptions) {
    this.installWatcher();
  }

  listSurfaces(): string[] {
    const root = workspaceRoot();
    if (!root) return [];
    const dir = surfacesDir(root);
    if (!fs.existsSync(dir)) return [];
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.html'))
        .map((e) => e.name.slice(0, -'.html'.length))
        .sort();
    } catch {
      return [];
    }
  }

  createOrUpdate(name: string, html: string): { ok: true; path: string } | { ok: false; error: string } {
    if (!SURFACE_NAME_RE.test(name)) {
      return { ok: false, error: `Invalid surface name "${name}". Use [A-Za-z0-9_-]+.` };
    }
    const root = workspaceRoot();
    if (!root) return { ok: false, error: 'No workspace folder is open.' };

    const dir = surfacesDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const file = surfaceFile(root, name);
    fs.writeFileSync(file, html);
    // If the panel is open, the watcher will trigger reload. But ensure prompt
    // feedback if the watcher is slow.
    const panel = this.panels.get(name);
    if (panel) panel.reload();
    return { ok: true, path: file };
  }

  delete(name: string): { ok: true; path: string } | { ok: false; error: string } {
    if (!SURFACE_NAME_RE.test(name)) {
      return { ok: false, error: `Invalid surface name "${name}".` };
    }
    const root = workspaceRoot();
    if (!root) return { ok: false, error: 'No workspace folder is open.' };
    const file = surfaceFile(root, name);
    if (!fs.existsSync(file)) return { ok: false, error: `Surface "${name}" does not exist.` };
    fs.unlinkSync(file);
    const panel = this.panels.get(name);
    if (panel) panel.dispose();
    return { ok: true, path: file };
  }

  openPanel(name: string, fromAi: boolean): OpenResult {
    if (fromAi && !this.opts.isAutoOpenEnabled()) {
      return {
        ok: false,
        reason: 'AI-initiated panel opening is disabled. Enable "Oboto VS: Surfaces Auto Open" in Oboto VS Settings, or open the surface manually via the command palette "Oboto VS: Open Surface".',
      };
    }
    if (!SURFACE_NAME_RE.test(name)) {
      return { ok: false, reason: `Invalid surface name "${name}".` };
    }
    const root = workspaceRoot();
    if (!root) return { ok: false, reason: 'No workspace folder is open.' };
    const file = surfaceFile(root, name);
    if (!fs.existsSync(file)) return { ok: false, reason: `Surface "${name}" does not exist.` };

    const existing = this.panels.get(name);
    if (existing) {
      existing.reveal();
      return { ok: true };
    }

    const panel = new SurfacePanel({
      name,
      filePath: file,
      workspaceRoot: root,
      routesUrl: this.opts.getRoutesUrl(),
      onDispose: () => { this.panels.delete(name); },
      onError: this.opts.onSurfaceError,
    });
    this.panels.set(name, panel);
    return { ok: true };
  }

  async openPicker(): Promise<void> {
    const names = this.listSurfaces();
    if (names.length === 0) {
      vscode.window.showInformationMessage('No surfaces found in .obotovs/surfaces/.');
      return;
    }
    const pick = await vscode.window.showQuickPick(names, {
      title: 'Oboto VS: Open Surface',
      placeHolder: 'Pick a surface to open',
    });
    if (!pick) return;
    const result = this.openPanel(pick, false);
    if (!result.ok && result.reason) {
      vscode.window.showErrorMessage(result.reason);
    }
  }

  /** Called by the orchestrator when the routes server base URL changes. */
  broadcastRoutesUrl(url: string | null): void {
    for (const panel of this.panels.values()) panel.setRoutesUrl(url);
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    for (const panel of this.panels.values()) panel.dispose();
    this.panels.clear();
  }

  private installWatcher(): void {
    const root = workspaceRoot();
    if (!root) return;
    const pattern = new vscode.RelativePattern(root, '.obotovs/surfaces/*.html');
    try {
      this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.watcher.onDidChange((uri) => {
        const name = path.basename(uri.fsPath, '.html');
        const panel = this.panels.get(name);
        if (panel) panel.reload();
      });
      this.watcher.onDidDelete((uri) => {
        const name = path.basename(uri.fsPath, '.html');
        const panel = this.panels.get(name);
        if (panel) panel.dispose();
      });
    } catch (err) {
      logger.warn('[surfaces] file watcher could not be installed', err);
    }
  }
}
