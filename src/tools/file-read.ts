import * as vscode from 'vscode';

export function createFileReadHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path || '');
    if (!filePath) return '[ERROR] Missing required argument: path';

    try {
      const uri = vscode.Uri.file(filePath);
      const content = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(content);
      const lines = text.split('\n');

      const offset = typeof kwargs.offset === 'number' ? kwargs.offset : 0;
      const limit = typeof kwargs.limit === 'number' ? kwargs.limit : 2000;

      const sliced = lines.slice(offset, offset + limit);
      const numbered = sliced.map((line, i) => `${String(offset + i + 1).padStart(5)}\t${line}`).join('\n');

      let result = numbered;
      if (offset > 0 || offset + limit < lines.length) {
        result += `\n\n[Showing lines ${offset + 1}-${Math.min(offset + limit, lines.length)} of ${lines.length}]`;
      }

      return result;
    } catch (err) {
      return `[ERROR] Failed to read file '${filePath}': ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
