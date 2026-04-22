import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { getSettings } from './settings';
import { logger } from '../shared/logger';

export interface AlephNetStatus {
  connected: boolean;
  port: number;
}

let managedProcess: ChildProcess | null = null;
let cachedStatus: AlephNetStatus | null = null;
let statusExpiry = 0;
const STATUS_TTL_MS = 5000;
let installInProgress = false;

export async function getAlephNetStatus(forceRefresh = false): Promise<AlephNetStatus> {
  const settings = getSettings();
  const port = settings.alephnet?.port || 31337;

  if (!forceRefresh && cachedStatus && Date.now() < statusExpiry) {
    return cachedStatus;
  }

  let connected = false;

  try {
    const response = await fetch(`http://localhost:${port}/status`, {
      method: 'GET',
    });
    if (response.ok) {
      connected = true;
    }
  } catch (err) {
    connected = false;
  }

  cachedStatus = {
    connected,
    port,
  };
  statusExpiry = Date.now() + STATUS_TTL_MS;

  return cachedStatus;
}

export async function ensureAlephNetNode(): Promise<AlephNetStatus> {
  let status = await getAlephNetStatus();

  if (status.connected) {
    return status;
  }

  if (installInProgress) {
    // Wait for the current install/start to finish
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!installInProgress) {
        return getAlephNetStatus(true);
      }
    }
    throw new Error('Timeout waiting for AlephNet node to start.');
  }

  installInProgress = true;
  try {
    const settings = getSettings();
    if (!settings.alephnet?.enabled) {
      throw new Error('AlephNet is not enabled in settings.');
    }

    logger.info('Starting AlephNet managed node...');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace folder open. AlephNet requires a workspace.');
    }

    const runnerPath = path.join(__dirname, '..', '..', 'scripts', 'alephnet-runner.js');
    const dataPath = path.join(workspaceRoot, '.obotovs', 'alephnet');

    managedProcess = spawn('node', [runnerPath], {
      env: {
        ...process.env,
        ALEPHNET_PORT: settings.alephnet.port.toString(),
        ALEPHNET_DATA_PATH: dataPath,
      },
      cwd: workspaceRoot,
      stdio: 'pipe',
    });

    managedProcess.stdout?.on('data', (data) => {
      logger.info(`[AlephNet] ${data.toString().trim()}`);
    });

    managedProcess.stderr?.on('data', (data) => {
      logger.error(`[AlephNet] ${data.toString().trim()}`);
    });

    managedProcess.on('error', (err) => {
      logger.error('AlephNet process error', err);
      managedProcess = null;
    });

    managedProcess.on('exit', (code) => {
      logger.info(`AlephNet process exited with code ${code}`);
      managedProcess = null;
    });

    // Wait for it to become responsive
    logger.info('Waiting for AlephNet server to start...');
    let refreshed = await getAlephNetStatus(true);
    for (let i = 0; i < 15; i++) {
      if (refreshed.connected) {
        logger.info('AlephNet server is running.');
        return refreshed;
      }
      await new Promise((r) => setTimeout(r, 1000));
      refreshed = await getAlephNetStatus(true);
    }

    throw new Error('AlephNet server started but is not responding to /status check.');
  } finally {
    installInProgress = false;
  }
}

export function stopAlephNetNode() {
  if (managedProcess) {
    logger.info('Stopping AlephNet managed node...');
    managedProcess.kill();
    managedProcess = null;
  }
}
