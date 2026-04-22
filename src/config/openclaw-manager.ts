import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { getSettings } from './settings';
import { logger } from '../shared/logger';

export interface OpenClawStatus {
  connected: boolean;
  mode: 'managed' | 'connected';
  url: string;
  version?: string;
  latency?: number;
}

let managedProcess: ChildProcess | null = null;
let cachedStatus: OpenClawStatus | null = null;
let statusExpiry = 0;
const STATUS_TTL_MS = 5_000;

export async function getOpenClawStatus(force = false): Promise<OpenClawStatus> {
  if (!force && cachedStatus && Date.now() < statusExpiry) return cachedStatus;

  const settings = getSettings();
  const config = settings.openclaw || { mode: 'connected', url: 'http://localhost:8099/v1' };

  let connected = false;
  let version = 'unknown';
  let latency = -1;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    // OpenClaw might have a /models or /health endpoint. We'll use /models to be safe as it's an OpenAI compatible endpoint.
    const res = await fetch(`${config.url}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      connected = true;
      latency = Date.now() - start;
      const data = await res.json() as any;
      // Just a simple check to see if it responds like an OpenAI provider
      if (data && data.object === 'list') {
        version = 'openclaw-compatible';
      }
    }
  } catch (err) {
    connected = false;
  }

  cachedStatus = {
    connected,
    mode: config.mode,
    url: config.url,
    version,
    latency,
  };
  statusExpiry = Date.now() + STATUS_TTL_MS;

  return cachedStatus;
}

export async function startOpenClaw(): Promise<void> {
  const settings = getSettings();
  const config = settings.openclaw || { mode: 'connected', url: 'http://localhost:8099/v1' };

  if (config.mode === 'connected') {
    throw new Error('OpenClaw is configured in "connected" mode. Cannot start it locally.');
  }

  if (managedProcess) {
    logger.info('OpenClaw is already running as a managed process.');
    return;
  }

  logger.info('Starting managed OpenClaw server...');
  
  // Try to find the openclaw binary or executable script.
  // For now, we will assume it's available in the PATH as `openclaw` or via `npx openclaw`.
  // As per integration instructions, we spawn it as a background task.
  try {
    managedProcess = spawn('npx', ['openclaw', 'serve', '--port', '8099'], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env },
    });

    managedProcess.unref();
    
    managedProcess.on('error', (err) => {
      logger.error('Failed to start OpenClaw:', err);
      managedProcess = null;
    });

    managedProcess.on('exit', (code) => {
      logger.warn(`OpenClaw managed process exited with code ${code}`);
      managedProcess = null;
    });

    // Wait for it to become ready
    let retries = 10;
    while (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const status = await getOpenClawStatus(true);
      if (status.connected) {
        logger.info('Managed OpenClaw server is ready.');
        return;
      }
      retries--;
    }
    
    throw new Error('OpenClaw started but failed to become responsive within 10 seconds.');
  } catch (err) {
    managedProcess = null;
    throw err;
  }
}

export async function stopOpenClaw(): Promise<void> {
  if (managedProcess) {
    logger.info('Stopping managed OpenClaw server...');
    managedProcess.kill();
    managedProcess = null;
  }
}

export async function ensureOpenClaw(): Promise<OpenClawStatus> {
  let status = await getOpenClawStatus(true);

  if (!status.connected) {
    if (status.mode === 'managed') {
      await startOpenClaw();
      status = await getOpenClawStatus(true);
      if (!status.connected) {
        throw new Error('Failed to start OpenClaw in managed mode.');
      }
    } else {
      throw new Error(`OpenClaw server at ${status.url} is unreachable.`);
    }
  }

  return status;
}
