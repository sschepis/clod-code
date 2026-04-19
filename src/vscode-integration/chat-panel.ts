import * as vscode from 'vscode';
import type { ExtToWebviewMessage, WebviewToExtMessage } from '../shared/message-types';
import type { WebviewTarget } from '../agent/webview-bridge';

export class ChatPanel implements WebviewTarget {
  static readonly viewType = 'clodcode.chatWindow';

  private readonly panel: vscode.WebviewPanel;
  private _messageHandler?: (msg: WebviewToExtMessage) => void;
  private _disposeHandler?: () => void;

  readonly panelId: string;
  label: string;

  constructor(
    extensionUri: vscode.Uri,
    panelId: string,
    label: string,
    existingPanel?: vscode.WebviewPanel,
  ) {
    this.panelId = panelId;
    this.label = label;

    if (existingPanel) {
      this.panel = existingPanel;
    } else {
      this.panel = vscode.window.createWebviewPanel(
        ChatPanel.viewType,
        `Chat: ${label || panelId.slice(0, 8)}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist'),
            vscode.Uri.joinPath(extensionUri, 'dist'),
          ],
        },
      );
    }

    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);

    this.panel.webview.onDidReceiveMessage((msg: WebviewToExtMessage) => {
      this._messageHandler?.(msg);
    });

    this.panel.onDidDispose(() => {
      this._disposeHandler?.();
    });
  }

  onMessage(handler: (msg: WebviewToExtMessage) => void): void {
    this._messageHandler = handler;
  }

  onDispose(handler: () => void): void {
    this._disposeHandler = handler;
  }

  postMessage(msg: ExtToWebviewMessage): void {
    this.panel.webview.postMessage(msg);
  }

  get isVisible(): boolean {
    return this.panel.visible;
  }

  get isActive(): boolean {
    return this.panel.active;
  }

  reveal(): void {
    this.panel.reveal();
  }

  setTitle(title: string): void {
    this.label = title;
    this.panel.title = `Chat: ${title}`;
  }

  dispose(): void {
    this.panel.dispose();
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const distUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.js')
    );
    const sharedUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'main.css')
    );
    const indexStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}' ${webview.cspSource};
      img-src ${webview.cspSource} blob: data:;
      font-src ${webview.cspSource};
      frame-src blob:;">
  <link rel="stylesheet" href="${styleUri}">
  <link rel="stylesheet" href="${indexStyleUri}">
  <link rel="modulepreload" href="${sharedUri}">
  <title>Chat: ${this.label || this.panelId.slice(0, 8)}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__CLODCODE_PANEL_AGENT_ID__ = ${JSON.stringify(this.panelId)};</script>
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
