import * as net from 'net';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { logger } from '../shared/logger';
import { RouteServer } from './route-server';
import { routesDir } from './route-loader';
import { loadRegistry, claimPort, releasePort, DEFAULT_PORT_START } from './port-store';

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

async function pickPort(preferred: number | undefined, busy: Set<number>): Promise<number> {
  const candidates: number[] = [];
  if (preferred && !busy.has(preferred)) candidates.push(preferred);
  for (let i = 0; i < 200; i++) {
    const p = DEFAULT_PORT_START + i;
    if (!busy.has(p)) candidates.push(p);
  }
  for (const p of candidates) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('No free port found in scan range');
}

export interface RouteManagerOptions {
  windowId: string;
  onBaseUrlChange?: (url: string | null) => void;
}

export class RouteManager {
  private server?: RouteServer;
  private starting?: Promise<string>;
  private watcher?: vscode.FileSystemWatcher;
  private readonly windowId: string;
  private readonly onBaseUrlChange?: (url: string | null) => void;

  constructor(opts: RouteManagerOptions) {
    this.windowId = opts.windowId;
    this.onBaseUrlChange = opts.onBaseUrlChange;
  }

  isRunning(): boolean { return !!this.server; }
  baseUrl(): string | null { return this.server?.baseUrl ?? null; }
  port(): number | null { return this.server?.port ?? null; }
  routes(): Array<{ urlPath: string; file: string }> { return this.server?.list() ?? []; }

  /** Start the server if not already running; returns the base URL. */
  async ensureStarted(): Promise<string> {
    if (this.server) return this.server.baseUrl;
    if (this.starting) return this.starting;

    const root = workspaceRoot();
    if (!root) throw new Error('No workspace folder — cannot start routes server');

    this.starting = (async () => {
      const reg = loadRegistry(root);
      const busy = new Set(
        reg.servers
          .filter((s) => s.windowId !== this.windowId)
          .map((s) => s.port),
      );
      const mine = reg.servers.find((s) => s.windowId === this.windowId);
      const port = await pickPort(mine?.port, busy);

      const server = new RouteServer({ workspaceRoot: root, port });
      await server.start();
      this.server = server;

      claimPort(root, {
        windowId: this.windowId,
        pid: process.pid,
        port,
        updatedAt: Date.now(),
      });

      // Watch the routes directory for create/delete/rename so the match table
      // stays current. File-*content* edits are hot-reloaded via mtime-keyed
      // dynamic import — no watcher needed for that.
      this.installWatcher(root);

      this.onBaseUrlChange?.(server.baseUrl);
      return server.baseUrl;
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  async stop(): Promise<void> {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (this.server) {
      const root = workspaceRoot();
      if (root) {
        try { releasePort(root, this.windowId); } catch (err) {
          logger.warn('[routes] releasePort failed', err);
        }
      }
      await this.server.stop();
      this.server = undefined;
      this.onBaseUrlChange?.(null);
    }
  }

  /** Called by tool handlers after any route file mutation. */
  notifyChanged(): void {
    this.server?.rescan();
  }

  private installWatcher(root: string): void {
    const pattern = new vscode.RelativePattern(root, '.obotovs/routes/**/*');
    try {
      this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
      
      let debounceTimer: NodeJS.Timeout | null = null;
      const trigger = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.server?.rescan();
          debounceTimer = null;
        }, 150);
      };

      this.watcher.onDidCreate(trigger);
      this.watcher.onDidDelete(trigger);
      this.watcher.onDidChange(trigger);
    } catch (err) {
      logger.warn('[routes] file watcher could not be installed', err);
    }

    // Also ensure the directory exists so the watcher sees subsequent creates.
    try { fs.mkdirSync(routesDir(root), { recursive: true }); } catch { /* ignore */ }
  }
}
