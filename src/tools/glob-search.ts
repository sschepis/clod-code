import * as vscode from 'vscode';

export function createGlobSearchHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const pattern = String(kwargs.pattern || '');
    if (!pattern) return '[ERROR] Missing required argument: pattern';

    const exclude = kwargs.exclude ? String(kwargs.exclude) : '**/node_modules/**';
    const maxResults = typeof kwargs.max_results === 'number' ? kwargs.max_results : 100;

    try {
      const files = await vscode.workspace.findFiles(pattern, exclude, maxResults);

      if (files.length === 0) {
        return `[INFO] No files matching pattern '${pattern}'.`;
      }

      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const paths = files
        .map(f => rootPath ? f.fsPath.replace(rootPath + '/', '') : f.fsPath)
        .sort();

      return `[SUCCESS] Found ${paths.length} file(s) matching '${pattern}':\n${paths.join('\n')}`;
    } catch (err) {
      return `[ERROR] Glob search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
