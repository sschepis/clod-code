import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ExtToWebviewMessage } from '../shared/message-types';
import type { UserPromptBridge } from '../agent/user-prompt-bridge';

export interface SecretDeps {
  bridge: UserPromptBridge;
  post: (msg: ExtToWebviewMessage) => void;
  createEvent: (event: {
    id: string;
    promptId: string;
    name: string;
    description?: string;
    envPath: string;
  }) => void;
  resolveEvent: (promptId: string, result: {
    status: 'answered' | 'cancelled';
    savedToFile?: boolean;
  }) => void;
}

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

function resolveEnvPath(custom: string | undefined): { envPath: string; workspace: string | null } {
  const workspace = workspaceRoot();
  if (custom && path.isAbsolute(custom)) {
    return { envPath: custom, workspace };
  }
  if (custom && workspace) {
    return { envPath: path.join(workspace, custom), workspace };
  }
  if (workspace) {
    return { envPath: path.join(workspace, '.env'), workspace };
  }
  return { envPath: path.join(process.cwd(), '.env'), workspace: null };
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function escapeValue(value: string): string {
  if (value === '') return '""';
  if (/[\s"'#$`\\]/.test(value)) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return value;
}

function upsertEnv(envPath: string, key: string, value: string): void {
  const line = `${key}=${escapeValue(value)}`;
  let existing = '';
  try {
    existing = fs.readFileSync(envPath, 'utf8');
  } catch {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, line + '\n', { mode: 0o600 });
    return;
  }

  const lines = existing.split(/\r?\n/);
  const keyRe = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) {
      lines[i] = line;
      found = true;
      break;
    }
  }
  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push(line);
    else lines.splice(lines.length - (lines[lines.length - 1] === '' ? 1 : 0), 0, line);
  }
  const out = lines.join('\n');
  fs.writeFileSync(envPath, out.endsWith('\n') ? out : out + '\n', { mode: 0o600 });
  try { fs.chmodSync(envPath, 0o600); } catch { /* non-fatal on Windows */ }
}

function ensureGitignored(workspace: string, envPath: string): { ok: boolean; warning?: string } {
  const gitignorePath = path.join(workspace, '.gitignore');
  const relative = path.relative(workspace, envPath);
  if (relative.startsWith('..')) return { ok: true };

  let content = '';
  try {
    content = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    return { ok: false, warning: `No .gitignore found — consider adding "${relative}" to .gitignore.` };
  }

  const patterns = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const base = path.basename(relative);
  const covered = patterns.some((p) => p === relative || p === '/' + relative || p === base || p === '*.env' || p === '.env*');
  if (covered) return { ok: true };

  return { ok: false, warning: `"${relative}" is not listed in .gitignore — secrets may be committed. Add it to .gitignore.` };
}

export function createSecretHandler(deps: SecretDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    if (!name) return '[ERROR] Missing required argument: name';
    if (!KEY_RE.test(name)) {
      return `[ERROR] Invalid env var name "${name}". Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`;
    }

    const description = typeof kwargs.description === 'string' ? kwargs.description : undefined;
    const customPath = typeof kwargs.env_path === 'string' ? kwargs.env_path : undefined;
    const { envPath, workspace } = resolveEnvPath(customPath);

    const promptId = deps.bridge.nextId('s');
    const eventId = `secret-${promptId}`;

    deps.createEvent({ id: eventId, promptId, name, description, envPath });
    deps.post({ type: 'ask_secret', promptId, name, description, envPath });

    const result = await deps.bridge.registerSecret(promptId);

    if (result.cancelled || typeof result.value !== 'string') {
      deps.resolveEvent(promptId, { status: 'cancelled' });
      deps.post({ type: 'ask_secret_resolved', promptId, status: 'cancelled' });
      return `[USER CANCELLED] The user declined to provide a value for "${name}".`;
    }

    const value = result.value;
    const save = result.saveToFile ?? true;

    process.env[name] = value;

    let savedToFile = false;
    const warnings: string[] = [];

    if (save) {
      try {
        upsertEnv(envPath, name, value);
        savedToFile = true;
        if (workspace) {
          const gi = ensureGitignored(workspace, envPath);
          if (!gi.ok && gi.warning) warnings.push(gi.warning);
        }
      } catch (err) {
        warnings.push(`Failed to write ${envPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    deps.resolveEvent(promptId, { status: 'answered', savedToFile });
    deps.post({ type: 'ask_secret_resolved', promptId, status: 'answered', savedToFile });

    const parts = [
      `Secret "${name}" received from user.`,
      `Set in process.env for this session.`,
      savedToFile ? `Persisted to ${envPath}.` : (save ? `Not persisted (write failed).` : `Not persisted (user opted out).`),
    ];
    if (warnings.length > 0) parts.push(`Warnings: ${warnings.join(' ')}`);
    return parts.join(' ');
  };
}
