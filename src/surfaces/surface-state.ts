import * as fs from 'fs';
import * as path from 'path';

const STATE_DIR = '.obotovs/state';

function stateFile(workspaceRoot: string, surfaceName: string): string {
  return path.join(workspaceRoot, STATE_DIR, `${surfaceName}.json`);
}

function readStore(workspaceRoot: string, surfaceName: string): Record<string, unknown> {
  const file = stateFile(workspaceRoot, surfaceName);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(workspaceRoot: string, surfaceName: string, store: Record<string, unknown>): void {
  const file = stateFile(workspaceRoot, surfaceName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}

export function stateGet(workspaceRoot: string, surfaceName: string, key: string): unknown {
  return readStore(workspaceRoot, surfaceName)[key] ?? null;
}

export function stateSet(workspaceRoot: string, surfaceName: string, key: string, value: unknown): void {
  const store = readStore(workspaceRoot, surfaceName);
  store[key] = value;
  writeStore(workspaceRoot, surfaceName, store);
}

export function stateDelete(workspaceRoot: string, surfaceName: string, key: string): boolean {
  const store = readStore(workspaceRoot, surfaceName);
  if (!(key in store)) return false;
  delete store[key];
  writeStore(workspaceRoot, surfaceName, store);
  return true;
}

export function stateKeys(workspaceRoot: string, surfaceName: string): string[] {
  return Object.keys(readStore(workspaceRoot, surfaceName));
}
