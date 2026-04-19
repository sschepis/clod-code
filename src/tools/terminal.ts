import * as vscode from 'vscode';

export function createTerminalHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const cmd = String(kwargs.cmd || kwargs.command || '');
    const name = String(kwargs.name || 'Obotovs');

    // Find or create terminal
    let terminal = vscode.window.terminals.find(t => t.name === name);
    if (!terminal) {
      terminal = vscode.window.createTerminal({ name });
    }

    terminal.show(true);

    if (cmd) {
      terminal.sendText(cmd);
      return `[SUCCESS] Sent to terminal "${name}": ${cmd}`;
    }

    return `[SUCCESS] Terminal "${name}" is now focused.`;
  };
}
