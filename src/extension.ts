import { isMainThread, workerData } from 'worker_threads';
import { runRouteWorker } from './routes/route-worker-entry';

if (!isMainThread && workerData?.type === 'route-worker') {
  runRouteWorker();
}

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
import { logger } from './shared/logger';
import { currentWindowId, registerWindow, unregisterWindow } from './shared/window-id';

export async function activate(context: vscode.ExtensionContext) {
  // 1. Initialize the dedicated output channel for logging FIRST
  //    so any later errors are captured.
  const outputChannel = vscode.window.createOutputChannel('Clodcode');
  logger.init(outputChannel);
  context.subscriptions.push(outputChannel);

  // Mint + advertise this window's id so concurrent windows on the same
  // workspace don't clobber each other's session / fight over one port.
  const windowId = currentWindowId();
  registerWindow();
  context.subscriptions.push({ dispose: () => unregisterWindow() });

  logger.info('Activating Clodcode extension', {
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
    statusBar.updateModel({
      provider: initialSettings.remoteProvider,
      model: initialSettings.remoteModel,
      isLocal: false,
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

  // 5. Read settings
  const settings = getSettings();
  logger.info('Loaded settings', {
    localProvider: settings.localProvider,
    localModel: settings.localModel,
    remoteProvider: settings.remoteProvider,
    remoteModel: settings.remoteModel,
    permissionMode: settings.permissionMode,
  });

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
      });
    } catch (err) {
      logger.error('Failed to create orchestrator', err);
    }
  }


  // Register Clodcode Explorer
  try {
    const explorerProvider = new ExplorerProvider();
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('clodcode.explorer', explorerProvider),
      explorerProvider
    );
    // Optional: Register a command to refresh the explorer
    context.subscriptions.push(
      vscode.commands.registerCommand('clodcode.refreshExplorer', () => explorerProvider.refresh())
    );
    logger.info('Explorer Provider registered');
  } catch (err) {
    logger.error('Failed to register Explorer Provider', err);
  }

  // 8. Register commands — ALWAYS run this, even if orchestrator is missing
  try {
    registerCommands(context, orchestrator, sidebar, chatPanelManager);
    logger.info('Commands registered');
  } catch (err) {
    logger.error('Failed to register commands', err);
  }

  // 9. Watch for settings changes (debounced to coalesce multi-field saves)
  try {
    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
      onSettingsChanged((newSettings) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          logger.info('Settings changed, recreating agent', {
            remoteProvider: newSettings.remoteProvider,
            remoteModel: newSettings.remoteModel,
          });
          statusBar?.updateModel({
            provider: newSettings.remoteProvider,
            model: newSettings.remoteModel,
            isLocal: false,
          });
          try {
            await orchestrator?.recreateAgent(newSettings);
          } catch (err) {
            logger.error('Failed to recreate agent after settings change', err);
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
