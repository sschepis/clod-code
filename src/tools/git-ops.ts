import { execSync } from 'child_process';
import * as vscode from 'vscode';

function git(args: string, cwd?: string): string {
  const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  try {
    return execSync(`git ${args}`, {
      cwd: workDir,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch (err: any) {
    const output = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    return `[ERROR] git ${args}: ${output || err.message}`;
  }
}

export function createGitStatusHandler() {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    return git('status --short --branch');
  };
}

export function createGitDiffHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const staged = kwargs.staged === true ? '--staged' : '';
    const file = kwargs.file ? ` -- "${kwargs.file}"` : '';
    return git(`diff ${staged}${file}`);
  };
}

export function createGitLogHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const count = typeof kwargs.count === 'number' ? kwargs.count : 10;
    const oneline = kwargs.verbose ? '' : '--oneline';
    return git(`log -${count} ${oneline}`);
  };
}

export function createGitCommitHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const message = String(kwargs.message || '');
    if (!message) return '[ERROR] Missing required argument: message';

    const files = kwargs.files;
    if (files && Array.isArray(files)) {
      for (const f of files) {
        git(`add "${f}"`);
      }
    } else if (kwargs.all === true) {
      git('add -A');
    }

    return git(`commit -m "${message.replace(/"/g, '\\"')}"`);
  };
}

export function createGitBranchHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = kwargs.name ? String(kwargs.name) : undefined;
    const checkout = kwargs.checkout === true;

    if (!name) {
      return git('branch -a --sort=-committerdate');
    }

    if (checkout) {
      return git(`checkout -b "${name}"`);
    }

    return git(`branch "${name}"`);
  };
}

export function createGitStashHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const action = String(kwargs.action || 'list');
    switch (action) {
      case 'push': return git('stash push');
      case 'pop': return git('stash pop');
      case 'list': return git('stash list');
      case 'drop': return git('stash drop');
      default: return `[ERROR] Unknown stash action: ${action}. Use push, pop, list, or drop.`;
    }
  };
}
