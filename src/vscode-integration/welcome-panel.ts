import * as vscode from 'vscode';
import { logger } from '../shared/logger';

export class WelcomePanel {
  public static readonly viewType = 'obotovs.welcomePanel';
  private static currentPanel: WelcomePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (WelcomePanel.currentPanel) {
      WelcomePanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      WelcomePanel.viewType,
      'Welcome to Oboto VS',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist'),
          vscode.Uri.joinPath(extensionUri, 'dist'),
        ],
      },
    );

    WelcomePanel.currentPanel = new WelcomePanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (msg: { type: string; command?: string }) => {
        if (msg.type === 'command' && msg.command) {
          vscode.commands.executeCommand(msg.command);
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public dispose(): void {
    WelcomePanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const distUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist');
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'welcome.js'),
    );
    const sharedUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'main.js'),
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'main.css'),
    );
    const nonce = getNonce();
    const csp = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      style-src ${csp} 'unsafe-inline';
      script-src 'nonce-${nonce}' ${csp};
      img-src ${csp} blob: data:;
      font-src ${csp};">
  <link rel="stylesheet" href="${styleUri}">
  <link rel="modulepreload" href="${sharedUri}">
  <title>Welcome to Oboto VS</title>
</head>
<body>
  <div id="welcome-root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
