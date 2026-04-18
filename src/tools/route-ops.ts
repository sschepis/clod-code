import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RouteManager } from '../routes/route-manager';
import { scanRoutes } from '../routes/route-loader';

export interface RouteToolDeps {
  manager: RouteManager;
}

const ROUTE_PATH_RE = /^([A-Za-z0-9_\-\[\]])(?:\/?[A-Za-z0-9_\-\[\]]+)*\/?$/;

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

function routesRoot(): string | null {
  const root = workspaceRoot();
  if (!root) return null;
  return path.join(root, '.clodcode', 'routes');
}

/** Normalize `"/users/[id]/"` → `"users/[id]"`. */
function normalizeRoutePath(input: string): string {
  return input.replace(/^\/+|\/+$/g, '');
}

function routeFileFor(rp: string): { dir: string; file: string } | null {
  const root = routesRoot();
  if (!root) return null;
  const dir = path.join(root, ...rp.split('/'));
  return { dir, file: path.join(dir, 'route.js') };
}

function pruneEmptyDirs(dir: string, stopAt: string): void {
  let cur = dir;
  while (cur.startsWith(stopAt) && cur !== stopAt) {
    try {
      const entries = fs.readdirSync(cur);
      if (entries.length > 0) break;
      fs.rmdirSync(cur);
    } catch { break; }
    cur = path.dirname(cur);
  }
}

export function createRouteListHandler(deps: RouteToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    // If the server isn't running, scan the filesystem directly so the
    // AI can still see what exists without triggering a lazy start.
    if (deps.manager.isRunning()) {
      const routes = deps.manager.routes();
      if (routes.length === 0) return 'No routes registered.';
      return routes.map((r) => `${r.urlPath}  (${r.file})`).join('\n');
    }
    const root = routesRoot();
    if (!root || !fs.existsSync(root)) return 'No routes directory yet.';
    const entries = scanRoutes(workspaceRoot()!);
    if (entries.length === 0) return 'No routes found under .clodcode/routes/.';
    return entries.map((e) => `${e.urlPath}  (${e.file})`).join('\n');
  };
}

export function createRouteInfoHandler(deps: RouteToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const running = deps.manager.isRunning();
    const baseUrl = deps.manager.baseUrl();
    const port = deps.manager.port();
    const routes = deps.manager.routes();
    return JSON.stringify({ running, baseUrl, port, routes }, null, 2);
  };
}

export function createRouteCreateHandler(deps: RouteToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const rawPath = String(kwargs.path || '').trim();
    const code = typeof kwargs.code === 'string' ? kwargs.code : '';
    if (!rawPath) return '[ERROR] Missing required argument: path';
    if (!code) return '[ERROR] Missing required argument: code';

    const rp = normalizeRoutePath(rawPath);
    if (!ROUTE_PATH_RE.test(rp)) {
      return `[ERROR] Invalid route path "${rawPath}". Use segments like "hello" or "users/[id]".`;
    }
    const target = routeFileFor(rp);
    if (!target) return '[ERROR] No workspace folder is open.';

    fs.mkdirSync(target.dir, { recursive: true });
    fs.writeFileSync(target.file, code);

    deps.manager.notifyChanged();
    let url = deps.manager.baseUrl();
    if (!url) {
      try {
        url = await deps.manager.ensureStarted();
      } catch (err) {
        return `[WARN] Route written to ${target.file}, but the server failed to start: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    const urlPath = '/' + rp.split('/').map((s) => s.startsWith('[') && s.endsWith(']') ? ':' + s.slice(1, -1) : s).join('/');
    return `[SUCCESS] Route created at ${target.file}. URL: ${url}${urlPath}`;
  };
}

export function createRouteUpdateHandler(deps: RouteToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const rawPath = String(kwargs.path || '').trim();
    const code = typeof kwargs.code === 'string' ? kwargs.code : '';
    if (!rawPath) return '[ERROR] Missing required argument: path';
    if (!code) return '[ERROR] Missing required argument: code';

    const rp = normalizeRoutePath(rawPath);
    if (!ROUTE_PATH_RE.test(rp)) return `[ERROR] Invalid route path "${rawPath}".`;
    const target = routeFileFor(rp);
    if (!target) return '[ERROR] No workspace folder is open.';

    if (!fs.existsSync(target.file)) {
      return `[ERROR] Route "${rp}" does not exist. Use route/create instead.`;
    }
    fs.writeFileSync(target.file, code);
    deps.manager.notifyChanged();
    return `[SUCCESS] Route updated at ${target.file}.`;
  };
}

export function createRouteDeleteHandler(deps: RouteToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const rawPath = String(kwargs.path || '').trim();
    if (!rawPath) return '[ERROR] Missing required argument: path';
    const rp = normalizeRoutePath(rawPath);
    if (!ROUTE_PATH_RE.test(rp)) return `[ERROR] Invalid route path "${rawPath}".`;
    const target = routeFileFor(rp);
    if (!target) return '[ERROR] No workspace folder is open.';

    if (!fs.existsSync(target.file)) {
      return `[ERROR] Route "${rp}" does not exist.`;
    }
    fs.unlinkSync(target.file);
    const root = routesRoot()!;
    pruneEmptyDirs(target.dir, root);
    deps.manager.notifyChanged();
    return `[SUCCESS] Deleted route "${rp}".`;
  };
}

export function createRouteHandlers(deps: RouteToolDeps) {
  return {
    list: createRouteListHandler(deps),
    info: createRouteInfoHandler(deps),
    create: createRouteCreateHandler(deps),
    update: createRouteUpdateHandler(deps),
    delete: createRouteDeleteHandler(deps),
  };
}
