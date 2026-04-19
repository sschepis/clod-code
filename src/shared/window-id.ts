import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from './logger';

export interface WindowPresence {
  windowId: string;
  pid: number;
  createdAt: number;
  /** Port of this window's peer-coordination HTTP+SSE server on 127.0.0.1. */
  coordPort?: number;
}

let cached: string | undefined;

/** Stable id for the lifetime of this extension-host process (i.e. this window). */
export function currentWindowId(): string {
  if (!cached) cached = crypto.randomUUID();
  return cached;
}

export function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

function windowsDir(root: string): string {
  return path.join(root, '.obotovs', 'windows');
}

function presenceFile(root: string, id: string): string {
  return path.join(windowsDir(root), `${id}.json`);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e.code === 'EPERM') return true;
    return false;
  }
}

/** Write a presence file advertising this window's existence in the workspace. */
export function registerWindow(extra?: Partial<WindowPresence>): void {
  const root = workspaceRoot();
  if (!root) {
    logger.warn('[peers] registerWindow: no workspace root — skipping presence file');
    return;
  }
  const dir = windowsDir(root);
  const id = currentWindowId();
  const payload: WindowPresence = {
    windowId: id,
    pid: process.pid,
    createdAt: Date.now(),
    ...extra,
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const filePath = presenceFile(root, id);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
    logger.info(`[peers] registered window ${id.slice(0, 8)} (pid=${process.pid}) at ${filePath}`);
  } catch (err) {
    logger.error('[peers] registerWindow failed to write presence file', err);
  }
}

/** Update arbitrary fields of this window's presence file (e.g. coordPort). */
export function updateWindowPresence(patch: Partial<WindowPresence>): void {
  const root = workspaceRoot();
  if (!root || !cached) {
    logger.warn('[peers] updateWindowPresence: no root or no cached id — skipping');
    return;
  }
  const file = presenceFile(root, cached);
  let current: WindowPresence = {
    windowId: cached,
    pid: process.pid,
    createdAt: Date.now(),
  };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') current = { ...current, ...parsed };
  } catch { /* first write */ }
  const next: WindowPresence = { ...current, ...patch };
  try {
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    logger.info(`[peers] updated presence for ${cached.slice(0, 8)}: ${JSON.stringify(patch)}`);
  } catch (err) {
    logger.error('[peers] updateWindowPresence failed to write', err);
  }
}

/** Remove this window's presence file. Safe to call multiple times. */
export function unregisterWindow(): void {
  const root = workspaceRoot();
  if (!root || !cached) return;
  try {
    fs.unlinkSync(presenceFile(root, cached));
    logger.info(`[peers] unregistered window ${cached.slice(0, 8)}`);
  } catch { /* gone already */ }
}

/**
 * Scan the workspace's presence directory. Entries whose PID is dead are
 * treated as stale: not returned and silently unlinked.
 */
export function listActiveWindows(): WindowPresence[] {
  const root = workspaceRoot();
  if (!root) return [];
  const dir = windowsDir(root);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    logger.warn(`[peers] listActiveWindows: cannot read ${dir}`, err);
    return [];
  }

  const live: WindowPresence[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        parsed && typeof parsed.windowId === 'string' &&
        typeof parsed.pid === 'number' && typeof parsed.createdAt === 'number'
      ) {
        if (isAlive(parsed.pid)) {
          live.push(parsed as WindowPresence);
          continue;
        }
        // PID is dead — clean up stale presence file
        logger.info(`[peers] removing stale presence file ${name} (pid=${parsed.pid} is dead)`);
        try { fs.unlinkSync(file); } catch { /* ignore */ }
      } else {
        // Malformed file — skip but don't delete (might be mid-write by another process)
        logger.warn(`[peers] skipping malformed presence file ${name}`);
      }
    } catch (err) {
      // Parse error — skip but don't delete (file may be mid-write)
      logger.warn(`[peers] skipping unreadable presence file ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return live;
}

/** Return the presence directory path for diagnostics. */
export function getPresenceDirPath(): string | null {
  const root = workspaceRoot();
  if (!root) return null;
  return windowsDir(root);
}

/** Raw scan of the presence directory — returns ALL files with their content,
 *  without filtering by alive/coordPort. Used for diagnostics only. */
export function listPresenceFilesRaw(): Array<{
  filename: string;
  content: WindowPresence | null;
  error?: string;
  alive?: boolean;
}> {
  const root = workspaceRoot();
  if (!root) return [];
  const dir = windowsDir(root);
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return []; }

  const results: Array<{
    filename: string;
    content: WindowPresence | null;
    error?: string;
    alive?: boolean;
  }> = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as WindowPresence;
      results.push({
        filename: name,
        content: parsed,
        alive: typeof parsed.pid === 'number' ? isAlive(parsed.pid) : undefined,
      });
    } catch (err) {
      results.push({
        filename: name,
        content: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
