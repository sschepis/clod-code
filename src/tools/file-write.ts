import * as vscode from 'vscode';
import * as path from 'path';

export function createFileWriteHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path || '');
    const content = String(kwargs.content ?? '');
    if (!filePath) return '[ERROR] Missing required argument: path';

    try {
      const uri = vscode.Uri.file(filePath);

      // Check if file exists and read for diff
      let oldContent = '';
      let isNew = false;
      try {
        const existing = await vscode.workspace.fs.readFile(uri);
        oldContent = new TextDecoder().decode(existing);
      } catch {
        isNew = true;
      }

      // Ensure parent directory exists
      const dirUri = vscode.Uri.file(path.dirname(filePath));
      try {
        await vscode.workspace.fs.createDirectory(dirUri);
      } catch {
        // Directory may already exist
      }

      // Write the file
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));

      if (isNew) {
        return `[SUCCESS] Created new file: ${filePath} (${content.length} bytes)`;
      }

      // Generate a simple diff summary
      const oldLines = oldContent.split('\n');
      const newLines = content.split('\n');
      const added = newLines.length - oldLines.length;

      return `[SUCCESS] Updated file: ${filePath}\nLines: ${oldLines.length} → ${newLines.length} (${added >= 0 ? '+' : ''}${added})`;
    } catch (err) {
      return `[ERROR] Failed to write file '${filePath}': ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
