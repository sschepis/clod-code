import * as vscode from 'vscode';

export class AiFileTracker implements vscode.FileDecorationProvider {
  private tracked = new Set<string>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  add(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.tracked.has(key)) return;
    this.tracked.add(key);
    this._onDidChange.fire(uri);
  }

  clear(): void {
    if (this.tracked.size === 0) return;
    this.tracked.clear();
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.tracked.has(uri.toString())) return undefined;
    return {
      badge: '✦',
      tooltip: 'Modified by Oboto',
      color: new vscode.ThemeColor('charts.blue'),
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
