import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { SurfaceManager } from '../surfaces/surface-manager';
import { logger } from '../shared/logger';

export interface SurfaceToolDeps {
  manager: SurfaceManager;
}

function surfaceFilePath(name: string): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return path.join(folders[0].uri.fsPath, '.obotovs', 'surfaces', `${name}.html`);
}

export function createSurfaceListHandler(deps: SurfaceToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const names = deps.manager.listSurfaces();
    if (names.length === 0) return 'No surfaces found in .obotovs/surfaces/.';
    return names.join('\n');
  };
}

export function createSurfaceCreateHandler(deps: SurfaceToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    const html = typeof kwargs.html === 'string' ? kwargs.html : '';
    if (!name) return '[ERROR] Missing required argument: name';
    if (!html) return '[ERROR] Missing required argument: html';

    const result = deps.manager.createOrUpdate(name, html);
    if (!result.ok) return `[ERROR] ${result.error}`;
    deps.manager.openPanel(name, true);
    return `[SUCCESS] Wrote surface "${name}" to ${result.path} (${html.length} bytes).`;
  };
}

export function createSurfaceUpdateHandler(deps: SurfaceToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    const html = typeof kwargs.html === 'string' ? kwargs.html : '';
    if (!name) return '[ERROR] Missing required argument: name';
    if (!html) return '[ERROR] Missing required argument: html';

    const file = surfaceFilePath(name);
    if (!file) return '[ERROR] No workspace folder is open.';
    if (!fs.existsSync(file)) {
      return `[ERROR] Surface "${name}" does not exist. Use surface/create instead.`;
    }

    const result = deps.manager.createOrUpdate(name, html);
    if (!result.ok) return `[ERROR] ${result.error}`;
    deps.manager.openPanel(name, true);
    return `[SUCCESS] Updated surface "${name}" at ${result.path} (${html.length} bytes).`;
  };
}

export function createSurfaceDeleteHandler(deps: SurfaceToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    if (!name) return '[ERROR] Missing required argument: name';
    const result = deps.manager.delete(name);
    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Deleted surface "${name}" (${result.path}).`;
  };
}

export function createSurfaceOpenHandler(deps: SurfaceToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    if (!name) return '[ERROR] Missing required argument: name';
    const result = deps.manager.openPanel(name, true);
    if (!result.ok) return `[ERROR] ${result.reason ?? 'Failed to open panel.'}`;
    return `[SUCCESS] Opened surface "${name}" in a webview panel.`;
  };
}

function screenshotDir(): string {
  const folders = vscode.workspace.workspaceFolders;
  const base = folders?.[0]?.uri.fsPath ?? process.cwd();
  return path.join(base, '.obotovs', 'screenshots');
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function createSurfaceScreenshotHandler(deps: SurfaceToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    if (!name) return '[ERROR] Missing required argument: name (surface name)';

    const label = typeof kwargs.label === 'string' && kwargs.label.trim()
      ? kwargs.label.trim().replace(/[^A-Za-z0-9_-]/g, '_')
      : `${name}-${timestamp()}`;

    try {
      const png = await deps.manager.captureSurface(name);

      const dir = screenshotDir();
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${label}.png`);
      fs.writeFileSync(filePath, png);

      logger.info(`[surface-screenshot] saved ${filePath} (${png.length} bytes)`);
      return `[SUCCESS] Screenshot of surface "${name}" saved to ${filePath} (${png.length} bytes).\n\n![${label}](${vscode.Uri.file(filePath).toString()})`;
    } catch (err) {
      return `[ERROR] Screenshot of surface "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

// Convenience aggregator for the tool-tree file.
export function createSurfaceHandlers(deps: SurfaceToolDeps) {
  return {
    list: createSurfaceListHandler(deps),
    create: createSurfaceCreateHandler(deps),
    update: createSurfaceUpdateHandler(deps),
    delete: createSurfaceDeleteHandler(deps),
    open: createSurfaceOpenHandler(deps),
    screenshot: createSurfaceScreenshotHandler(deps),
  };
}
