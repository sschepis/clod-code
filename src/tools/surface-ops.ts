import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { SurfaceManager } from '../surfaces/surface-manager';

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

// Convenience aggregator for the tool-tree file.
export function createSurfaceHandlers(deps: SurfaceToolDeps) {
  return {
    list: createSurfaceListHandler(deps),
    create: createSurfaceCreateHandler(deps),
    update: createSurfaceUpdateHandler(deps),
    delete: createSurfaceDeleteHandler(deps),
    open: createSurfaceOpenHandler(deps),
  };
}
