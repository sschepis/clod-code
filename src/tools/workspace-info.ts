import * as vscode from 'vscode';

export function createWorkspaceInfoHandler() {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const folders = vscode.workspace.workspaceFolders || [];
    const openEditors = vscode.window.visibleTextEditors;
    const rootPath = folders[0]?.uri.fsPath || '(no workspace)';

    const lines = [
      `Workspace: ${folders.map(f => f.name).join(', ') || '(none)'}`,
      `Root: ${rootPath}`,
      `Open files (${openEditors.length}):`,
      ...openEditors.map(e => {
        const rel = rootPath !== '(no workspace)'
          ? e.document.uri.fsPath.replace(rootPath + '/', '')
          : e.document.uri.fsPath;
        return `  ${rel} (${e.document.languageId})`;
      }),
    ];

    return lines.join('\n');
  };
}

export function createOpenFilesHandler() {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const editors = vscode.window.visibleTextEditors;
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    if (editors.length === 0) return '[INFO] No files currently open in the editor. Use file/read to open a file, or search/glob to find files in the workspace.';

    const lines = editors.map(e => {
      const rel = rootPath ? e.document.uri.fsPath.replace(rootPath + '/', '') : e.document.uri.fsPath;
      const modified = e.document.isDirty ? ' (modified)' : '';
      return `${rel} [${e.document.languageId}]${modified}`;
    });

    return `[SUCCESS] Open files (${editors.length}):\n${lines.join('\n')}`;
  };
}
