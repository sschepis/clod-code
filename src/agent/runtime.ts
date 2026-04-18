import * as path from 'path';
import type { AgentRuntime } from '@sschepis/as-agent';
import { dynamicImport } from '../shared/dynamic-import';

let _runtime: AgentRuntime | undefined;

/**
 * Load the as-agent WASM runtime.
 * The WASM file is bundled in dist/release.wasm during build.
 * Returns a cached runtime on subsequent calls.
 */
export async function getAgentRuntime(extensionPath: string): Promise<AgentRuntime> {
  if (_runtime) return _runtime;

  try {
    const { createRuntime } = await dynamicImport<typeof import('@sschepis/as-agent')>('@sschepis/as-agent');
    const wasmPath = path.join(extensionPath, 'dist', 'release.wasm');
    _runtime = await createRuntime(wasmPath);
    return _runtime;
  } catch (err) {
    // WASM loading is optional — features like slash commands
    // will be unavailable but the agent still works
    console.warn('[clodcode] Failed to load as-agent WASM runtime:', err);
    throw err;
  }
}

/**
 * Get the cached runtime if already loaded, or undefined.
 */
export function getCachedRuntime(): AgentRuntime | undefined {
  return _runtime;
}
