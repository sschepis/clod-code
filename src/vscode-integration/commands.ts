import * as vscode from 'vscode';
import { COMMANDS } from '../shared/constants';
import type { Orchestrator } from '../agent/orchestrator';
import type { SidebarProvider } from './sidebar-provider';
import type { ChatPanelManager } from './chat-panel-manager';
import type { ExplorerNode, ExplorerProvider } from './explorer-provider';
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
  explorerProvider?: ExplorerProvider,
): void {
  // Restore persisted provider test results so the settings UI
  // shows green/orange/red indicators from the previous session.
  SettingsPanel.initialize(context);

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

  // Open a surface (webview panel rendered from .obotovs/surfaces/<name>.html)
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_SURFACE, async (surfaceName?: string) => {
      if (!orchestrator) {
        vscode.window.showWarningMessage('Oboto VS orchestrator is not available.');
        return;
      }
      if (surfaceName) {
        orchestrator.getSurfaceManager().openPanel(surfaceName, false);
      } else {
        await orchestrator.getSurfaceManager().openPicker();
      }
    })
  );

  // ── Surface toolbar commands ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SURFACE_REFRESH, () => {
      orchestrator?.getSurfaceManager().getActiveSurface()?.reload();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SURFACE_VIEW_SOURCE, async () => {
      const panel = orchestrator?.getSurfaceManager().getActiveSurface();
      if (!panel) return;
      const doc = await vscode.workspace.openTextDocument(panel.filePath);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SURFACE_INSPECT, () => {
      vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SURFACE_OPEN_IN_BROWSER, () => {
      const panel = orchestrator?.getSurfaceManager().getActiveSurface();
      if (!panel) return;
      vscode.env.openExternal(vscode.Uri.file(panel.filePath));
    })
  );

  // Focus chat — needs sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.FOCUS_CHAT, () => {
      if (!sidebar) {
        vscode.window.showWarningMessage('Oboto VS chat panel is not available.');
        return;
      }
      sidebar.focus();
    })
  );

  // Interrupt / stop agent — always available, no-op if nothing is running
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.INTERRUPT, () => {
      if (!orchestrator) return;
      orchestrator.interrupt();
    })
  );

  // ── Agent-dependent commands ────────────────────────────────────

  // New session
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.NEW_SESSION, async () => {
      if (!sidebar) {
        vscode.window.showWarningMessage('Oboto VS is not initialized. Check the output log.');
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
          'Oboto VS agent is not initialized. Open Settings to configure a provider.'
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
        vscode.window.showWarningMessage('Oboto VS chat panel is not available.');
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
        vscode.window.showWarningMessage('Oboto VS is not initialized.');
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
        vscode.window.showWarningMessage('Oboto VS is not initialized.');
        return;
      }
      const panels = chatPanelManager.listPanels();
      if (panels.length === 0) {
        vscode.window.showInformationMessage('No additional chat windows open. Use "Oboto VS: New Chat Window" to create one.');
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

  // ── Context Menu Helpers ─────────────────────────────────────────

  const askWithSelection = async (promptPrefix: string) => {
    if (!orchestrator) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    if (selection.isEmpty) return;

    const text = editor.document.getText(selection);
    const fileName = editor.document.fileName.split(/[\\/]/).pop();
    const prompt = `${promptPrefix}\n\n\`\`\`${editor.document.languageId}\n// ${fileName}\n${text}\n\`\`\``;

    // Try to find the active webview panel first, fallback to sidebar
    const targetId = chatPanelManager?.getActivePanelId();
    if (targetId) {
      chatPanelManager?.focusPanel(targetId);
      await orchestrator.submitToAgent(targetId, prompt);
    } else {
      await vscode.commands.executeCommand('obotovs.chatPanel.focus');
      await orchestrator.submitToAgent('foreground', prompt);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLAIN_CODE, () => askWithSelection('Please explain the following code:'))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.REFACTOR_CODE, () => askWithSelection('Please refactor the following code to improve readability and performance:'))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.WRITE_TESTS, () => askWithSelection('Please write unit tests for the following code:'))
  );

  // ── Explorer context menu commands ──────────────────────────────
  // Tree view commands receive (clickedNode, selectedNodes[]) when canSelectMany is true.

  const resolveNodes = (node: ExplorerNode, selected?: ExplorerNode[]): ExplorerNode[] =>
    selected && selected.length > 0 ? selected : node ? [node] : [];

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_OPEN_FILE, (node: ExplorerNode, selected?: ExplorerNode[]) => {
      for (const n of resolveNodes(node, selected)) {
        if (n.resourceUri) {
          vscode.commands.executeCommand('vscode.open', n.resourceUri);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_DELETE_FILE, async (node: ExplorerNode, selected?: ExplorerNode[]) => {
      const nodes = resolveNodes(node, selected).filter(n => n.resourceUri);
      if (nodes.length === 0) return;
      const label = nodes.length === 1
        ? `"${(nodes[0].label as string) || nodes[0].resourceUri!.fsPath.split('/').pop()}"`
        : `${nodes.length} items`;
      const confirm = await vscode.window.showWarningMessage(
        `Move ${label} to Trash?`, { modal: true }, 'Move to Trash'
      );
      if (confirm !== 'Move to Trash') return;
      for (const n of nodes) {
        try {
          await vscode.workspace.fs.delete(n.resourceUri!, { recursive: true, useTrash: true });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_REVEAL_IN_FINDER, (node: ExplorerNode) => {
      if (node.resourceUri) {
        vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_COPY_PATH, (node: ExplorerNode, selected?: ExplorerNode[]) => {
      const paths = resolveNodes(node, selected)
        .filter(n => n.resourceUri)
        .map(n => n.resourceUri!.fsPath);
      if (paths.length > 0) {
        vscode.env.clipboard.writeText(paths.join('\n'));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_COPY_RELATIVE_PATH, (node: ExplorerNode, selected?: ExplorerNode[]) => {
      const paths = resolveNodes(node, selected)
        .filter(n => n.resourceUri)
        .map(n => vscode.workspace.asRelativePath(n.resourceUri!, false));
      if (paths.length > 0) {
        vscode.env.clipboard.writeText(paths.join('\n'));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_CANCEL_TASK, (node: ExplorerNode, selected?: ExplorerNode[]) => {
      if (!orchestrator) return;
      for (const n of resolveNodes(node, selected)) {
        if (n.agentId) orchestrator.cancelAgent(n.agentId);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_COPY_TASK_RESULT, async (node: ExplorerNode) => {
      if (!node.agentId || !orchestrator) return;
      const summaries = orchestrator.getAgentSummaries();
      const agent = summaries.find(a => a.id === node.agentId);
      if (agent?.result) {
        await vscode.env.clipboard.writeText(agent.result);
        vscode.window.showInformationMessage('Task result copied to clipboard.');
      } else if (agent?.error) {
        await vscode.env.clipboard.writeText(agent.error);
        vscode.window.showInformationMessage('Task error copied to clipboard.');
      } else {
        vscode.window.showInformationMessage('No result available for this task.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_RERUN_TASK, async (node: ExplorerNode) => {
      if (!node.agentId || !orchestrator) return;
      const summaries = orchestrator.getAgentSummaries();
      const agent = summaries.find(a => a.id === node.agentId);
      if (!agent?.task) {
        vscode.window.showWarningMessage('No task prompt available to re-run.');
        return;
      }
      await orchestrator.submitToAgent('foreground', `Re-run the following task:\n\n${agent.task}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORER_FOCUS_TASK, (node: ExplorerNode) => {
      if (node.agentId && sidebar) {
        sidebar.postMessage({ type: 'agents_sync', agents: orchestrator?.getAgentSummaries() ?? [], focusedAgentId: node.agentId });
      }
    })
  );
}
