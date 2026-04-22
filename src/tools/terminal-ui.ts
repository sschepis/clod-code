import * as vscode from 'vscode';

export function createTerminalUiStateHandler() {
  return async (): Promise<string> => {
    // Fetch recent commands executed if shell integration is available
    const terminals = await Promise.all(vscode.window.terminals.map(async t => ({
      name: t.name,
      state: t.state,
      processId: await t.processId,
      cwd: t.shellIntegration?.cwd?.fsPath,
      exitStatus: t.exitStatus,
      hasShellIntegration: !!t.shellIntegration,
    })));
    
    return JSON.stringify({ terminals }, null, 2);
  };
}
