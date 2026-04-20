import * as vscode from 'vscode';
import { execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listOllamaModels, isOllamaRunning, pullOllamaModel } from './model-listing';
import { DEFAULT_LOCAL_BASE_URLS } from '../shared/constants';
import { logger } from '../shared/logger';

export const MANAGED_PROVIDER_ID = 'oboto';
export const MANAGED_DEFAULT_MODEL = 'qwen2.5-coder:7b';
export const RECOMMENDED_MANAGED_MODELS = [
  'qwen2.5-coder:7b',
  'qwen2.5-coder:14b',
  'qwen2.5-coder:32b',
  'deepseek-coder-v2:16b',
  'deepseek-coder-v2:236b',
  'llama3.1:8b',
  'llama3.1:70b',
  'mistral:7b',
  'mixtral:8x7b',
  'phi3:14b'
];

export const MANAGED_BASE_URL = DEFAULT_LOCAL_BASE_URLS.ollama;

export interface ManagedProviderStatus {
  ollamaRunning: boolean;
  ollamaInstalled: boolean;
  modelAvailable: boolean;
  modelName: string;
  baseUrl: string;
  availableModels: string[];
}

let cachedStatus: ManagedProviderStatus | null = null;
let statusExpiry = 0;
const STATUS_TTL_MS = 10_000;

let installInProgress = false;

export async function getManagedProviderStatus(force = false): Promise<ManagedProviderStatus> {
  if (!force && cachedStatus && Date.now() < statusExpiry) return cachedStatus;

  const baseUrl = MANAGED_BASE_URL;
  const installed = await isOllamaInstalled();
  const running = installed ? await isOllamaRunning(baseUrl) : false;

  if (!running) {
    cachedStatus = {
      ollamaRunning: false,
      ollamaInstalled: installed,
      modelAvailable: false,
      modelName: '',
      baseUrl,
      availableModels: [],
    };
    statusExpiry = Date.now() + STATUS_TTL_MS;
    return cachedStatus;
  }

  const availableModels = await listOllamaModels(baseUrl);
  const modelName = availableModels[0] ?? '';

  cachedStatus = {
    ollamaRunning: true,
    ollamaInstalled: true,
    modelAvailable: availableModels.length > 0,
    modelName,
    baseUrl,
    availableModels,
  };
  statusExpiry = Date.now() + STATUS_TTL_MS;
  return cachedStatus;
}

export async function getManagedProviderModels(): Promise<string[]> {
  const status = await getManagedProviderStatus();
  return status.availableModels;
}

export async function ensureManagedProvider(targetModel?: string): Promise<ManagedProviderStatus> {
  let status = await getManagedProviderStatus(true);

  if (!status.ollamaInstalled) {
    logger.info('Ollama not installed — starting auto-install');
    await installOllama();
    status = await getManagedProviderStatus(true);
    if (!status.ollamaInstalled) {
      throw new Error(
        'Failed to install Ollama automatically. ' +
        'Please install it manually from https://ollama.com and restart VS Code.',
      );
    }
  }

  if (!status.ollamaRunning) {
    logger.info('Ollama installed but not running — starting it');
    await startOllama();
    await waitForOllama(MANAGED_BASE_URL, 15_000);
    status = await getManagedProviderStatus(true);
    if (!status.ollamaRunning) {
      throw new Error(
        'Ollama is installed but failed to start. ' +
        'Try starting it manually: run "ollama serve" in a terminal, then reload the window.',
      );
    }
  }

  const modelToEnsure = targetModel || MANAGED_DEFAULT_MODEL;
  if (!status.availableModels.includes(modelToEnsure)) {
    logger.info(`Model ${modelToEnsure} not found locally — auto-pulling`);
    await autoPullModel(modelToEnsure, status.baseUrl);
    const refreshed = await getManagedProviderStatus(true);
    if (!refreshed.availableModels.includes(modelToEnsure)) {
      throw new Error(`Failed to pull model "${modelToEnsure}". Check Ollama logs.`);
    }
    return refreshed;
  }

  return status;
}

// ── Ollama detection ────────────────────────────────────────────────

const OLLAMA_PATHS_MACOS = [
  '/usr/local/bin/ollama',
  '/opt/homebrew/bin/ollama',
  path.join(os.homedir(), '.ollama', 'bin', 'ollama'),
  '/Applications/Ollama.app/Contents/Resources/ollama',
];

const OLLAMA_PATHS_LINUX = [
  '/usr/local/bin/ollama',
  '/usr/bin/ollama',
  path.join(os.homedir(), '.local', 'bin', 'ollama'),
];

async function isOllamaInstalled(): Promise<boolean> {
  const which = await whichOllama();
  return which !== null;
}

async function whichOllama(): Promise<string | null> {
  try {
    const result = await execFileAsync('which', ['ollama']);
    const p = result.stdout.trim();
    if (p) return p;
  } catch { /* not in PATH */ }

  const candidates = os.platform() === 'darwin' ? OLLAMA_PATHS_MACOS : OLLAMA_PATHS_LINUX;
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  if (os.platform() === 'darwin' && existsSync('/Applications/Ollama.app')) {
    return '/Applications/Ollama.app';
  }

  return null;
}

// ── Ollama installation ─────────────────────────────────────────────

async function installOllama(): Promise<void> {
  if (installInProgress) {
    logger.info('Ollama install already in progress, skipping');
    return;
  }
  installInProgress = true;

  try {
    const platform = os.platform();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Oboto: Installing Ollama',
        cancellable: false,
      },
      async (progress) => {
        if (platform === 'darwin') {
          await installOllamaMacOS(progress);
        } else if (platform === 'linux') {
          await installOllamaLinux(progress);
        } else {
          throw new Error(
            `Auto-install is not supported on ${platform}. ` +
            'Please install Ollama manually from https://ollama.com',
          );
        }
      },
    );

    invalidateCache();
    logger.info('Ollama installation complete');
  } finally {
    installInProgress = false;
  }
}

async function installOllamaMacOS(
  progress: vscode.Progress<{ message?: string }>,
): Promise<void> {
  // Try Homebrew first (non-interactive, cleanest)
  const brewPath = await findBrew();
  if (brewPath) {
    progress.report({ message: 'Installing via Homebrew...' });
    logger.info('Installing Ollama via Homebrew');
    try {
      await execFileAsync(brewPath, ['install', 'ollama'], { timeout: 300_000 });
      return;
    } catch (err) {
      logger.warn('Homebrew install failed, falling back to direct download', err);
    }
  }

  // Direct download: official install script handles macOS
  progress.report({ message: 'Downloading from ollama.com...' });
  logger.info('Installing Ollama via official install script');
  await runInstallScript(progress);
}

async function installOllamaLinux(
  progress: vscode.Progress<{ message?: string }>,
): Promise<void> {
  progress.report({ message: 'Installing via official script...' });
  logger.info('Installing Ollama via official install script (Linux)');
  await runInstallScript(progress);
}

async function runInstallScript(
  progress: vscode.Progress<{ message?: string }>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const curlProc = spawn('curl', ['-fsSL', 'https://ollama.com/install.sh'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let scriptBody = '';
    curlProc.stdout.on('data', (chunk: Buffer) => { scriptBody += chunk.toString(); });

    let curlErr = '';
    curlProc.stderr.on('data', (chunk: Buffer) => { curlErr += chunk.toString(); });

    curlProc.on('close', (code) => {
      if (code !== 0 || !scriptBody) {
        reject(new Error(`Failed to download install script: ${curlErr || `exit code ${code}`}`));
        return;
      }

      progress.report({ message: 'Running installer...' });

      const sh = spawn('sh', ['-s'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, OLLAMA_INSTALL_QUIET: '1' },
      });

      sh.stdin.write(scriptBody);
      sh.stdin.end();

      let output = '';
      let errOutput = '';
      sh.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const lines = output.split('\n');
        const last = lines.filter(l => l.trim()).pop();
        if (last) progress.report({ message: last.slice(0, 80) });
      });
      sh.stderr.on('data', (chunk: Buffer) => { errOutput += chunk.toString(); });

      sh.on('close', (shCode) => {
        if (shCode !== 0) {
          logger.error('Ollama install script failed', { output, errOutput });
          reject(new Error(`Install script failed (exit ${shCode}): ${errOutput.slice(0, 200)}`));
        } else {
          resolve();
        }
      });
    });
  });
}

async function findBrew(): Promise<string | null> {
  for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    if (existsSync(p)) return p;
  }
  try {
    const r = await execFileAsync('which', ['brew']);
    const p = r.stdout.trim();
    if (p) return p;
  } catch { /* not found */ }
  return null;
}

// ── Ollama startup ──────────────────────────────────────────────────

async function startOllama(): Promise<void> {
  const platform = os.platform();

  if (platform === 'darwin' && existsSync('/Applications/Ollama.app')) {
    logger.info('Starting Ollama.app');
    spawn('open', ['-a', 'Ollama'], { stdio: 'ignore', detached: true }).unref();
    return;
  }

  const binary = await whichOllama();
  if (!binary) {
    throw new Error('Cannot find ollama binary to start the service.');
  }

  logger.info(`Starting ollama serve from ${binary}`);
  const child = spawn(binary, ['serve'], {
    stdio: 'ignore',
    detached: true,
    env: { ...process.env },
  });
  child.unref();
}

async function waitForOllama(baseUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaRunning(baseUrl)) return;
    await sleep(500);
  }
}

// ── Model auto-pull ─────────────────────────────────────────────────

async function autoPullModel(modelName: string, baseUrl: string): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Oboto: Downloading ${modelName}`,
      cancellable: false,
    },
    async (progress) => {
      await pullOllamaModel(
        modelName,
        (status, pct) => {
          progress.report({
            message: pct !== undefined ? `${status} (${pct}%)` : status,
            increment: undefined,
          });
        },
        baseUrl,
      );
    },
  );
  invalidateCache();
}

// ── Helpers ─────────────────────────────────────────────────────────

function invalidateCache(): void {
  cachedStatus = null;
  statusExpiry = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function execFileAsync(
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts?.timeout ?? 30_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}
