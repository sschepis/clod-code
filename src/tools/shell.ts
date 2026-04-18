import { execSync, spawn } from 'child_process';
import * as vscode from 'vscode';

export function createShellRunHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const cmd = String(kwargs.cmd || kwargs.command || '');
    if (!cmd) return '[ERROR] Missing required argument: cmd';

    const timeoutMs = typeof kwargs.timeout === 'number' ? kwargs.timeout : 30_000;
    const cwd = String(kwargs.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());

    try {
      const output = execSync(cmd, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        encoding: 'utf-8',
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output || '[No output]';
    } catch (err: any) {
      // execSync throws on non-zero exit code, but we still want the output
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

export function createShellBackgroundHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const cmd = String(kwargs.cmd || kwargs.command || '');
    if (!cmd) return '[ERROR] Missing required argument: cmd';

    const cwd = String(kwargs.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());

    const child = spawn(cmd, [], {
      cwd,
      shell: true,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, TERM: 'dumb' },
    });
    child.unref();

    return `[SUCCESS] Started background process (PID: ${child.pid}): ${cmd}`;
  };
}
