import * as vscode from 'vscode';
import * as path from 'path';

export function createFileWriteHandler(onFileChanged?: (filePath: string) => void) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path || '');
    const content = String(kwargs.content ?? '');
    if (!filePath) return '[ERROR] Missing required argument: path. Provide an absolute path or workspace-relative path (e.g. "src/utils/helper.ts"). Parent directories are created automatically.';

    try {
      const uri = vscode.Uri.file(filePath);

      // Check if file exists and read for diff
      let oldContent = '';
      let isNew = false;
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
      if (doc) {
        oldContent = doc.getText();
      } else {
        try {
          const existing = await vscode.workspace.fs.readFile(uri);
          oldContent = new TextDecoder().decode(existing);
        } catch {
          isNew = true;
        }
      }

      // Ensure parent directory exists
      const dirUri = vscode.Uri.file(path.dirname(filePath));
      try {
        await vscode.workspace.fs.createDirectory(dirUri);
      } catch {
        // Directory may already exist
      }

      // Write the file
      if (doc) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length),
        );
        edit.replace(uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);
      } else {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
      }
      onFileChanged?.(filePath);

      if (isNew) {
        return `[SUCCESS] Created new file: ${filePath} (${content.length} bytes)`;
      }

      // Generate a simple diff summary
      const oldLines = oldContent.split('\n');
      const newLines = content.split('\n');
      const added = newLines.length - oldLines.length;

      return `[SUCCESS] Updated file: ${filePath}\nLines: ${oldLines.length} → ${newLines.length} (${added >= 0 ? '+' : ''}${added})`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('EACCES') || msg.includes('permission')) {
        return `[ERROR] Permission denied writing '${filePath}': ${msg}. Check file/directory permissions.`;
      }
      if (msg.includes('ENOSPC')) {
        return `[ERROR] Disk full — cannot write '${filePath}'. Free disk space and retry.`;
      }
      return `[ERROR] Failed to write file '${filePath}': ${msg}`;
    }
  };
}
