import * as vscode from 'vscode';

export function createGlobSearchHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const pattern = String(kwargs.pattern || '');
    if (!pattern) return '[ERROR] Missing required argument: pattern. Examples: "**/*.ts" (all TypeScript files), "src/**/*.test.*" (all test files in src/), "**/package.json" (all package.json files).';

    const exclude = kwargs.exclude ? String(kwargs.exclude) : '**/node_modules/**';
    const maxResults = typeof kwargs.max_results === 'number' ? kwargs.max_results : 100;

    try {
      const files = await vscode.workspace.findFiles(pattern, exclude, maxResults);

      if (files.length === 0) {
        return `[INFO] No files matching pattern '${pattern}'.\n` +
          `Suggestions:\n` +
          `  - Check for typos in the pattern\n` +
          `  - Try a broader pattern (e.g. "**/*.ts" instead of "src/**/*.ts")\n` +
          `  - The default exclude is "${exclude}" — pass exclude="" to include node_modules\n` +
          `  - Use search/grep to search file contents instead of file names`;
      }

      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const paths = files
        .map(f => rootPath ? f.fsPath.replace(rootPath + '/', '') : f.fsPath)
        .sort();

      return `[SUCCESS] Found ${paths.length} file(s) matching '${pattern}':\n${paths.join('\n')}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[ERROR] Glob search failed: ${msg}. Check that the pattern uses valid glob syntax (e.g. "**/*.ts", "src/{a,b}/*.js").`;
    }
  };
}
