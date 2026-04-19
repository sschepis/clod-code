import { execSync, spawn } from 'child_process';
import * as vscode from 'vscode';

export interface ShellDeps {
  getShell: () => string;
}

function resolveShell(deps: ShellDeps): string {
  const configured = deps.getShell();
  return configured || process.env.SHELL || '/bin/sh';
}

export function createShellRunHandler(deps: ShellDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const cmd = String(kwargs.cmd || kwargs.command || '');
    if (!cmd) return '[ERROR] Missing required argument: cmd';

    const timeoutMs = typeof kwargs.timeout === 'number' ? kwargs.timeout : 30_000;
    const cwd = String(kwargs.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
    const shell = resolveShell(deps);

    try {
      const output = execSync(cmd, {
        cwd,
        shell,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output || '[No output]';
    } catch (err: any) {
      if (err.stdout || err.stderr) {
        const stdout = err.stdout?.toString() || '';
        const stderr = err.stderr?.toString() || '';
        const exitCode = err.status ?? 'unknown';
        return `[Exit code: ${exitCode}]\n${stdout}${stderr ? '\n[STDERR]\n' + stderr : ''}`;
      }
      return `[ERROR] Command failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createShellBackgroundHandler(deps: ShellDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const cmd = String(kwargs.cmd || kwargs.command || '');
    if (!cmd) return '[ERROR] Missing required argument: cmd';

    const cwd = String(kwargs.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
    const shell = resolveShell(deps);

    const child = spawn(cmd, [], {
      cwd,
      shell,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, TERM: 'dumb' },
    });
    child.unref();

    return `[SUCCESS] Started background process (PID: ${child.pid}): ${cmd}`;
  };
}
