import * as vscode from 'vscode';
import * as path from 'path';
import type { ExtToWebviewMessage, WebviewToExtMessage } from '../shared/message-types';
import { VIEW_ID } from '../shared/constants';

/**
 * WebviewViewProvider for the Oboto VS sidebar panel.
 * Manages the webview lifecycle and message routing between the
 * React UI and the agent orchestrator.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_ID;

  private _view?: vscode.WebviewView;
  private _messageHandler?: (msg: WebviewToExtMessage) => void;
  private _pendingMessages: ExtToWebviewMessage[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Forward messages from webview to the registered handler
    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtMessage) => {
      this._messageHandler?.(msg);
    });

    // When the view becomes visible, flush any pending messages
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._pendingMessages.length > 0) {
        for (const msg of this._pendingMessages) {
          webviewView.webview.postMessage(msg);
        }
        this._pendingMessages = [];
      }
    });
  }

  /**
   * Register a handler for messages from the webview.
   * This is called by the orchestrator during initialization.
   */
  public onMessage(handler: (msg: WebviewToExtMessage) => void) {
    this._messageHandler = handler;
  }

  /**
   * Send a message to the webview. If the webview is not visible,
   * buffer the message and send when it becomes visible.
   */
  public postMessage(message: ExtToWebviewMessage) {
    if (this._view?.visible) {
      this._view.webview.postMessage(message);
    } else {
      // Buffer for when the webview becomes visible
      // Only buffer certain message types that represent state changes
      if (message.type === 'sync' || message.type === 'clear' || message.type === 'model_changed') {
        this._pendingMessages.push(message);
      }
    }
  }

  /**
   * Focus the webview in the sidebar.
   */
  public focus() {
    if (this._view) {
      this._view.show(false);
    } else {
      vscode.commands.executeCommand(`${SidebarProvider.viewType}.focus`);
    }
  }

  public get isVisible(): boolean {
    return this._view?.visible ?? false;
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist');

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
  <title>Oboto</title>
</head>
<body>
  <div id="root"></div>
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
