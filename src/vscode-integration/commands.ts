import * as vscode from 'vscode';
import { COMMANDS } from '../shared/constants';
import type { Orchestrator } from '../agent/orchestrator';
import type { SidebarProvider } from './sidebar-provider';
import type { ChatPanelManager } from './chat-panel-manager';
import { PROVIDERS } from '../config/provider-registry';
import { SettingsPanel } from './settings-panel';
import { logger } from '../shared/logger';

/**
 * Register all VS Code commands. Commands that don't depend on the
 * orchestrator or sidebar are always available — this ensures users
 * can still open settings and logs even if agent initialization failed.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  orchestrator: Orchestrator | undefined,
  sidebar: SidebarProvider | undefined,
  chatPanelManager?: ChatPanelManager,
): void {
  // ── Always-available commands ────────────────────────────────────

  // Open settings panel — always works
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_SETTINGS, () => {
      logger.info('Opening settings panel');
      SettingsPanel.createOrShow(context.extensionUri);
    })
  );

  // Show output channel logs — always works
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SHOW_LOGS, () => {
      logger.show();
    })
  );

  // Open a surface (webview panel rendered from .clodcode/surfaces/<name>.html)
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_SURFACE, async () => {
      if (!orchestrator) {
        vscode.window.showWarningMessage('Clodcode orchestrator is not available.');
        return;
      }
      await orchestrator.getSurfaceManager().openPicker();
    })
  );

  // Focus chat — needs sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.FOCUS_CHAT, () => {
      if (!sidebar) {
        vscode.window.showWarningMessage('Clodcode chat panel is not available.');
        return;
      }
      sidebar.focus();
    })
  );

  // ── Agent-dependent commands ────────────────────────────────────

  // New session
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.NEW_SESSION, async () => {
      if (!sidebar) {
        vscode.window.showWarningMessage('Clodcode is not initialized. Check the output log.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        'Start a new session? Current session will be archived.',
        'Yes', 'No'
      );
      if (confirm !== 'Yes') return;
      sidebar.postMessage({ type: 'clear' });
    })
  );

  // Clear session
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.CLEAR_SESSION, () => {
      if (!sidebar) return;
      sidebar.postMessage({ type: 'clear' });
    })
  );

  // Switch model
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SWITCH_MODEL, async () => {
      if (!orchestrator) {
        vscode.window.showWarningMessage(
          'Clodcode agent is not initialized. Open Settings to configure a provider.'
        );
        return;
      }

      const items = Object.values(PROVIDERS).map(p => ({
        label: p.displayName,
        description: p.isLocal ? '(local)' : '(remote)',
        detail: p.requiresApiKey ? `Requires ${p.envKeyVar}` : 'No API key needed',
        provider: p.name,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select LLM provider',
        title: 'Switch Model',
      });

      if (!selected) return;

      const model = await vscode.window.showInputBox({
        prompt: `Model name for ${selected.label}`,
        placeHolder: 'e.g., claude-sonnet-4-20250514, gpt-4o, llama3:8b',
      });

      if (!model) return;

      await orchestrator.recreateAgent({
        ...require('../config/settings').getSettings(),
        remoteProvider: selected.provider,
        remoteModel: model,
      });

      vscode.window.showInformationMessage(`Switched to ${selected.label}: ${model}`);
    })
  );

  // Ask about selection
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.ASK_ABOUT_SELECTION, async () => {
      if (!sidebar) {
        vscode.window.showWarningMessage('Clodcode chat panel is not available.');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('No text selected.');
        return;
      }

      const question = await vscode.window.showInputBox({
        prompt: 'What would you like to ask about this code?',
        placeHolder: 'e.g., explain this, find bugs, refactor...',
      });

      if (!question) return;

      sidebar.focus();

      const filePath = editor.document.uri.fsPath;
      const lineNum = editor.selection.start.line + 1;
      const text = `${question}\n\nFrom \`${filePath}:${lineNum}\`:\n\`\`\`\n${selection}\n\`\`\``;

      sidebar.postMessage({
        type: 'event',
        event: {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      });
    })
  );

  // ── Multi-chat commands ────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.NEW_CHAT, async () => {
      if (!chatPanelManager) {
        vscode.window.showWarningMessage('Clodcode is not initialized.');
        return;
      }
      const label = await vscode.window.showInputBox({
        prompt: 'Name for this chat (optional)',
        placeHolder: 'e.g., refactoring-auth, debug-api',
      });
      if (label === undefined) return; // cancelled
      chatPanelManager.openNew(label || undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.LIST_CHATS, async () => {
      if (!chatPanelManager) {
        vscode.window.showWarningMessage('Clodcode is not initialized.');
        return;
      }
      const panels = chatPanelManager.listPanels();
      if (panels.length === 0) {
        vscode.window.showInformationMessage('No additional chat windows open. Use "Clodcode: New Chat Window" to create one.');
        return;
      }
      const items = panels.map(p => ({
        label: p.label || p.panelId,
        description: p.panelId,
        panelId: p.panelId,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a chat window to focus',
      });
      if (selected) {
        chatPanelManager.getPanel(selected.panelId)?.reveal();
      }
    })
  );
}
