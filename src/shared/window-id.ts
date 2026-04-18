import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

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
  return path.join(root, '.clodcode', 'windows');
}

function presenceFile(root: string, id: string): string {
  return path.join(windowsDir(root), `${id}.json`);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Write a presence file advertising this window's existence in the workspace. */
export function registerWindow(extra?: Partial<WindowPresence>): void {
  const root = workspaceRoot();
  if (!root) return;
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
    fs.writeFileSync(presenceFile(root, id), JSON.stringify(payload, null, 2) + '\n');
  } catch {
    // Best-effort — a workspace without a writable root isn't fatal.
  }
}

/** Update arbitrary fields of this window's presence file (e.g. coordPort). */
export function updateWindowPresence(patch: Partial<WindowPresence>): void {
  const root = workspaceRoot();
  if (!root || !cached) return;
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
  try { fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n'); }
  catch { /* best-effort */ }
}

/** Remove this window's presence file. Safe to call multiple times. */
export function unregisterWindow(): void {
  const root = workspaceRoot();
  if (!root || !cached) return;
  try { fs.unlinkSync(presenceFile(root, cached)); } catch { /* gone already */ }
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
  try { entries = fs.readdirSync(dir); } catch { return []; }

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
      }
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    } catch {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
  return live;
}
