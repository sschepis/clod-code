import * as vscode from 'vscode';

export function createDiagnosticsHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const severity = kwargs.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : undefined;
    const fileFilter = kwargs.file ? String(kwargs.file) : undefined;

    const allDiagnostics = vscode.languages.getDiagnostics();
    const lines: string[] = [];
    let errorCount = 0;
    let warningCount = 0;

    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    for (const [uri, diagnostics] of allDiagnostics) {
      const relativePath = rootPath ? uri.fsPath.replace(rootPath + '/', '') : uri.fsPath;

      if (fileFilter && !relativePath.includes(fileFilter)) continue;

      const filtered = severity !== undefined
        ? diagnostics.filter(d => d.severity === severity)
        : diagnostics;

      if (filtered.length === 0) continue;

      for (const d of filtered) {
        const severityLabel = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' :
          d.severity === vscode.DiagnosticSeverity.Warning ? 'WARN' : 'INFO';

        if (d.severity === vscode.DiagnosticSeverity.Error) errorCount++;
        if (d.severity === vscode.DiagnosticSeverity.Warning) warningCount++;

        lines.push(
          `${relativePath}:${d.range.start.line + 1}:${d.range.start.character + 1} [${severityLabel}] ${d.message}` +
          (d.source ? ` (${d.source})` : '')
        );
      }
    }

    if (lines.length === 0) {
      return '[INFO] No diagnostics found. All clear!';
    }

    return `[DIAGNOSTICS] ${errorCount} error(s), ${warningCount} warning(s)\n\n${lines.join('\n')}`;
  };
}
