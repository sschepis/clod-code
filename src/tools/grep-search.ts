import { execSync } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';

export function createGrepSearchHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const pattern = String(kwargs.pattern || '');
    if (!pattern) return '[ERROR] Missing required argument: pattern. Provide a regex pattern to search for in file contents (e.g. "function\\s+handleClick", "TODO|FIXME", "import.*from"). Use type or glob to filter file types.';

    const searchPath = String(kwargs.path || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.');
    const fileType = kwargs.type ? `--type ${kwargs.type}` : '';
    const glob = kwargs.glob ? `--glob '${kwargs.glob}'` : '';
    const contextLines = typeof kwargs.context === 'number' ? `-C ${kwargs.context}` : '';
    const caseSensitive = kwargs.case_insensitive ? '-i' : '';
    const maxResults = typeof kwargs.max_results === 'number' ? kwargs.max_results : 50;

    try {
      // Try to use ripgrep (bundled with VS Code or on PATH)
      const rgPath = findRipgrep();

      const args = [
        '--no-heading',
        '--line-number',
        '--color never',
        caseSensitive,
        fileType,
        glob,
        contextLines,
        `--max-count ${maxResults}`,
        `'${pattern.replace(/'/g, "'\\''")}'`,
        `'${searchPath}'`,
      ].filter(Boolean).join(' ');

      const output = execSync(`${rgPath} ${args}`, {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
        cwd: searchPath,
      });

      return output.trim() || `[INFO] No matches found for '${pattern}'. Try: broader pattern, case_insensitive=true, or remove type/glob filters. Use search/glob to find files by name instead of content.`;
    } catch (err: any) {
      // Exit code 1 means no matches (not an error)
      if (err.status === 1) {
        return `[INFO] No matches found for '${pattern}'. Try: broader pattern, case_insensitive=true, or remove type/glob filters. Use search/glob to find files by name instead of content.`;
      }
      const stderr = err.stderr?.toString() || '';
      const errMsg = stderr || (err instanceof Error ? err.message : String(err));
      if (errMsg.includes('regex parse error') || errMsg.includes('Syntax')) {
        return `[ERROR] Invalid regex pattern '${pattern}': ${errMsg}. Ripgrep uses Rust regex syntax — escape special characters like (, ), {, } with backslashes. For literal string search, escape regex metacharacters.`;
      }
      return `[ERROR] Grep search failed: ${errMsg}`;
    }
  };
}

function findRipgrep(): string {
  // VS Code bundles ripgrep — try that first
  try {
    const vscodeRg = path.join(
      vscode.env.appRoot,
      'node_modules', '@vscode', 'ripgrep', 'bin', 'rg'
    );
    execSync(`"${vscodeRg}" --version`, { stdio: 'pipe' });
    return `"${vscodeRg}"`;
  } catch {
    // Fall back to system ripgrep
    return 'rg';
  }
}
