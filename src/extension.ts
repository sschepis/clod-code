import * as vscode from 'vscode';
import { SidebarProvider } from './vscode-integration/sidebar-provider';
import { StatusBar } from './vscode-integration/status-bar';
import { ExplorerProvider } from './vscode-integration/explorer-provider';
import { registerCommands } from './vscode-integration/commands';
import { ChatPanelManager } from './vscode-integration/chat-panel-manager';
import { ChatPanel } from './vscode-integration/chat-panel';
import { Orchestrator } from './agent/orchestrator';
import { SessionStore } from './agent/session-store';
import { getSettings, onSettingsChanged } from './config/settings';
import { migrateSettingsIfNeeded, autoDetectProviders } from './config/settings-migration';
import { AiFileTracker } from './vscode-integration/ai-file-tracker';
import { ObotoCodeLensProvider, registerCodeLensCommands } from './vscode-integration/codelens-provider';
import { registerQuickTask } from './vscode-integration/quick-task';
import { logger } from './shared/logger';
import { currentWindowId, registerWindow, unregisterWindow } from './shared/window-id';

export async function activate(context: vscode.ExtensionContext) {
  // 1. Initialize the dedicated output channel for logging FIRST
  //    so any later errors are captured.
  const outputChannel = vscode.window.createOutputChannel('Oboto');
  logger.init(outputChannel);
  context.subscriptions.push(outputChannel);

  // Mint + advertise this window's id so concurrent windows on the same
  // workspace don't clobber each other's session / fight over one port.
  const windowId = currentWindowId();
  registerWindow();
  context.subscriptions.push({ dispose: () => unregisterWindow() });

  logger.info('Activating Oboto VS extension', {
    version: context.extension.packageJSON.version,
    vscodeVersion: vscode.version,
    windowId,
    pid: process.pid,
  });

  // Wrap each step in try/catch so one failure doesn't block the rest.
  // Commands MUST be registered even if agent init fails, so users can
  // still open settings and logs to diagnose.

  let sidebar: SidebarProvider | undefined;
  let statusBar: StatusBar | undefined;
  let sessionStore: SessionStore | undefined;
  let orchestrator: Orchestrator | undefined;
  let chatPanelManager: ChatPanelManager | undefined;
  let fileTracker: AiFileTracker | undefined;

  try {
    // 2. Create the sidebar webview provider
    sidebar = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
    logger.info('Sidebar provider registered');
  } catch (err) {
    logger.error('Failed to register sidebar provider', err);
  }

  try {
    // 3. Create status bar — initialized with actual current settings
    //    so it doesn't show stale "claude-sonnet-4" when the user has
    //    configured something else.
    statusBar = new StatusBar();
    const initialSettings = getSettings();
    const execRoute = initialSettings.routing?.executor;
    statusBar.updateModel({
      provider: execRoute?.providerId ?? 'oboto',
      model: execRoute?.model ?? '',
      isLocal: execRoute?.providerId === 'oboto',
    });
    context.subscriptions.push(statusBar);
    logger.info('Status bar created');
  } catch (err) {
    logger.error('Failed to create status bar', err);
  }

  try {
    // 4. Create session store
    sessionStore = new SessionStore(context.globalStorageUri, {
      windowId,
      workspaceState: context.workspaceState,
    });
  } catch (err) {
    logger.error('Failed to create session store', err);
  }

  // 5. Migrate old settings format if needed, then auto-detect providers from env vars
  try {
    await migrateSettingsIfNeeded();
    await autoDetectProviders();
  } catch (err) {
    logger.warn('Settings migration/auto-detect failed', err);
  }

  // 6. Read settings
  const settings = getSettings();
  logger.info('Loaded settings', {
    routing: settings.routing,
    providers: Object.keys(settings.providers),
    permissionMode: settings.permissionMode,
  });

  try {
    const { ensureAlephNetNode, stopAlephNetNode } = require('./config/alephnet-manager');
    if (settings.alephnet?.enabled) {
      ensureAlephNetNode().catch((e: any) => logger.warn('Failed to start AlephNet node in background:', e));
    }
    context.subscriptions.push({ dispose: () => stopAlephNetNode() });
  } catch (err) {
    logger.warn('AlephNet node init failed', err);
  }

  // 6. Create the orchestrator (non-blocking — uses try/catch)
  if (sidebar && sessionStore) {
    try {
      orchestrator = new Orchestrator(sidebar, sessionStore, settings, context.extensionPath, windowId, context);

      // Create ChatPanelManager for multi-chat support
      chatPanelManager = new ChatPanelManager(context.extensionUri, orchestrator, sessionStore);

      // Wire panel rename callback so agents can set their own chat title
      const cpm = chatPanelManager;
      orchestrator.setPanelRenamer((panelId, title) => {
        cpm.renamePanel(panelId, title);
      });
      orchestrator.setChatPanelOpener(() => {
        cpm.openNew();
      });
      orchestrator.setPanelRevealer((panelId) => {
        cpm.focusPanel(panelId);
      });

      // AI-modified file tracker — shows a badge on files written by the agent
      fileTracker = new AiFileTracker();
      context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(fileTracker),
        fileTracker,
      );
      orchestrator.setFileChangedCallback((filePath) => {
        fileTracker!.add(vscode.Uri.file(filePath));
      });
      orchestrator.setSessionClearedCallback(() => {
        fileTracker!.clear();
      });

      // Register panel serializer for VS Code to revive panels across reloads
      context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(ChatPanel.viewType, {
          async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
            const panelId = state?.panelId as string | undefined;
            const label = state?.label as string | undefined;
            if (panelId && chatPanelManager) {
              chatPanelManager.revivePanel(panelId, label ?? panelId, panel);
            }
          },
        })
      );

      // 7. Initialize the agent (async — don't block activation)
      orchestrator.initialize().then(async () => {
        logger.info('Agent initialized successfully');
        // Restore any previously open chat panels
        try {
          await chatPanelManager?.restoreAll();
        } catch (err) {
          logger.warn('Failed to restore chat panels', err);
        }
      }).catch(err => {
        logger.error('Agent initialization failed', err);
        vscode.commands.executeCommand('setContext', 'obotovs.agentReady', false);
      });
    } catch (err) {
      logger.error('Failed to create orchestrator', err);
    }
  }


  // Register Oboto VS Explorer
  let explorerProvider: ExplorerProvider | undefined;
  try {
    explorerProvider = new ExplorerProvider();
    if (orchestrator) {
      explorerProvider.setAgentProvider({
        listAll: () => orchestrator!.getAgentSummaries(),
      });
      orchestrator.onSummariesChanged(() => explorerProvider!.refresh());
    }
    const treeView = explorerProvider.createTreeView();
    context.subscriptions.push(treeView, explorerProvider);
    context.subscriptions.push(
      vscode.commands.registerCommand('obotovs.refreshExplorer', () => explorerProvider!.refresh())
    );
    logger.info('Explorer Provider registered');
  } catch (err) {
    logger.error('Failed to register Explorer Provider', err);
  }

  // 8. Register commands — ALWAYS run this, even if orchestrator is missing
  try {
    registerCommands(context, orchestrator, sidebar, chatPanelManager, explorerProvider);
    logger.info('Commands registered');
  } catch (err) {
    logger.error('Failed to register commands', err);
  }

  // 8b. CodeLens provider — "Ask Oboto" / "Explain" above functions and classes
  try {
    const codeLensProvider = new ObotoCodeLensProvider();
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
      codeLensProvider,
    );
    registerCodeLensCommands(context, (text) => {
      if (orchestrator) {
        vscode.commands.executeCommand('obotovs.chatPanel.focus');
        orchestrator.submitToAgent('foreground', text);
      }
    });
    logger.info('CodeLens provider registered');
  } catch (err) {
    logger.error('Failed to register CodeLens provider', err);
  }

  // 8c. Quick task picker
  try {
    registerQuickTask(context, orchestrator);
  } catch (err) {
    logger.error('Failed to register quick task', err);
  }

  // 9. Watch for settings changes (debounced to coalesce multi-field saves)
  try {
    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
      onSettingsChanged((newSettings) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const exec = newSettings.routing?.executor;
          logger.info('Settings changed, recreating agent', {
            executor: exec ? `${exec.providerId}/${exec.model ?? ''}` : 'unset',
          });
          statusBar?.updateModel({
            provider: exec?.providerId ?? 'oboto',
            model: exec?.model ?? '',
            isLocal: exec?.providerId === 'oboto',
          });
          try {
            await orchestrator?.recreateAgent(newSettings);
          } catch (err) {
            logger.error('Failed to recreate agent after settings change', err);
          }
          try {
            const { ensureAlephNetNode, stopAlephNetNode } = require('./config/alephnet-manager');
            if (newSettings.alephnet?.enabled) {
              ensureAlephNetNode().catch((e: any) => logger.warn('Failed to start AlephNet node', e));
            } else {
              stopAlephNetNode();
            }
          } catch (err) {
            logger.error('Failed to handle AlephNet settings change', err);
          }
        }, 500);
      })
    );
  } catch (err) {
    logger.error('Failed to watch settings', err);
  }

  // 10. Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      logger.info('Disposing extension');
      chatPanelManager?.disposeAll();
      orchestrator?.dispose();
    },
  });

  logger.info('Extension activated successfully');
}

export function deactivate() {
  logger.info('Extension deactivated');
}
