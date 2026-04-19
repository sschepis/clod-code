import * as fs from 'fs';
import * as path from 'path';
import { isAlive } from '../shared/window-id';

export const DEFAULT_PORT_START = 7438;

export interface PortEntry {
  windowId: string;
  pid: number;
  port: number;
  updatedAt: number;
}

export interface PortRegistry {
  servers: PortEntry[];
}

function obotovsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.obotovs');
}

function portFile(workspaceRoot: string): string {
  return path.join(obotovsDir(workspaceRoot), 'port.json');
}

function lockFile(workspaceRoot: string): string {
  return path.join(obotovsDir(workspaceRoot), 'port.lock');
}

// ── File lock (synchronous, 50ms × 40 = 2s max) ─────────────────────

const LOCK_STALE_MS = 5_000;

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function withLock<T>(workspaceRoot: string, fn: () => T): T {
  const dir = obotovsDir(workspaceRoot);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const lock = lockFile(workspaceRoot);

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      try {
        return fn();
      } finally {
        try { fs.closeSync(fd); } catch { /* ignore */ }
        try { fs.unlinkSync(lock); } catch { /* ignore */ }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Steal stale lock if nobody has touched it in a while.
      try {
        const st = fs.statSync(lock);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { fs.unlinkSync(lock); } catch { /* ignore */ }
          continue;
        }
      } catch { /* lock vanished between iterations */ }
      sleepSync(50);
    }
  }
  throw new Error('port registry lock timeout');
}

// ── Registry I/O ────────────────────────────────────────────────────

function readRegistryRaw(workspaceRoot: string): PortRegistry {
  try {
    const raw = fs.readFileSync(portFile(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.servers)) {
      const servers = parsed.servers.filter(
        (s: any) =>
          s && typeof s.windowId === 'string' &&
          typeof s.pid === 'number' &&
          typeof s.port === 'number' && s.port > 0 && s.port < 65536 &&
          typeof s.updatedAt === 'number',
      );
      return { servers };
    }
    // Legacy shape `{port: number}` → treat as empty; will be overwritten.
    return { servers: [] };
  } catch {
    return { servers: [] };
  }
}

function writeRegistryAtomic(workspaceRoot: string, reg: PortRegistry): void {
  const dir = obotovsDir(workspaceRoot);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const finalPath = portFile(workspaceRoot);
  const tmpPath = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(reg, null, 2) + '\n');
  fs.renameSync(tmpPath, finalPath);
}

/** Drop entries whose owning process no longer exists. Pure function. */
export function pruneStale(reg: PortRegistry): PortRegistry {
  return { servers: reg.servers.filter((s) => isAlive(s.pid)) };
}

/** Read + prune in one shot. Does NOT persist the pruned form. */
export function loadRegistry(workspaceRoot: string): PortRegistry {
  return pruneStale(readRegistryRaw(workspaceRoot));
}

/** Upsert this window's entry, writing atomically under the file lock. */
export function claimPort(workspaceRoot: string, entry: PortEntry): void {
  withLock(workspaceRoot, () => {
    const reg = pruneStale(readRegistryRaw(workspaceRoot));
    const filtered = reg.servers.filter((s) => s.windowId !== entry.windowId);
    filtered.push({ ...entry, updatedAt: Date.now() });
    writeRegistryAtomic(workspaceRoot, { servers: filtered });
  });
}

/** Remove this window's entry. Safe if missing. */
export function releasePort(workspaceRoot: string, windowId: string): void {
  withLock(workspaceRoot, () => {
    const reg = pruneStale(readRegistryRaw(workspaceRoot));
    const filtered = reg.servers.filter((s) => s.windowId !== windowId);
    if (filtered.length !== reg.servers.length) {
      writeRegistryAtomic(workspaceRoot, { servers: filtered });
    }
  });
}
