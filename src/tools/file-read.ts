import * as vscode from 'vscode';

export function createFileReadHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path || '');
    if (!filePath) return '[ERROR] Missing required argument: path. Provide an absolute path or workspace-relative path (e.g. "src/index.ts"). Use search/glob to find files by pattern.';

    try {
      const uri = vscode.Uri.file(filePath);
      let text: string;
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
      if (doc) {
        text = doc.getText();
      } else {
        const content = await vscode.workspace.fs.readFile(uri);
        text = new TextDecoder().decode(content);
      }
      const lines = text.split('\n');

      const rawOffset = typeof kwargs.offset === 'number' ? kwargs.offset : 1;
      const offset = Math.max(1, rawOffset);
      const limit = typeof kwargs.limit === 'number' ? kwargs.limit : 2000;
      const startIdx = offset - 1;

      const sliced = lines.slice(startIdx, startIdx + limit);
      const numbered = sliced.map((line, i) => `${String(offset + i).padStart(5)}\t${line}`).join('\n');

      let result = numbered;
      if (startIdx > 0 || startIdx + limit < lines.length) {
        result += `\n\n[Showing lines ${offset}-${Math.min(offset + limit - 1, lines.length)} of ${lines.length}]`;
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') || msg.includes('FileNotFound')) {
        return `[ERROR] File not found: '${filePath}'. Check the path is correct — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
      }
      if (msg.includes('EACCES') || msg.includes('permission')) {
        return `[ERROR] Permission denied reading '${filePath}': ${msg}. The file exists but cannot be read — check file permissions.`;
      }
      if (msg.includes('EISDIR')) {
        return `[ERROR] '${filePath}' is a directory, not a file. Use search/glob to list files in a directory (e.g. pattern="${filePath}/**/*").`;
      }
      return `[ERROR] Failed to read file '${filePath}': ${msg}`;
    }
  };
}
