import * as vscode from 'vscode';
import type { ToolbarButton } from '../shared/message-types';
import type { WebviewBridge } from '../agent/webview-bridge';

export class ToolbarRegistry {
  private buttons = new Map<string, ToolbarButton>();
  private actionHandlers = new Map<string, (actionId: string) => Promise<void> | void>();

  constructor(private bridge: WebviewBridge) {}

  public registerButton(button: ToolbarButton, handler: (actionId: string) => Promise<void> | void): vscode.Disposable {
    this.buttons.set(button.id, button);
    this.actionHandlers.set(button.actionId, handler);
    this.broadcast();

    return new vscode.Disposable(() => {
      this.buttons.delete(button.id);
      this.actionHandlers.delete(button.actionId);
      this.broadcast();
    });
  }

  public async executeAction(actionId: string): Promise<void> {
    const handler = this.actionHandlers.get(actionId);
    if (handler) {
      try {
        await handler(actionId);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Toolbar action failed: ${err.message || String(err)}`);
      }
    }
  }

  private broadcast() {
    const buttonList = Array.from(this.buttons.values());
    this.bridge.post({
      type: 'set_toolbar_buttons',
      buttons: buttonList
    });
  }
}
