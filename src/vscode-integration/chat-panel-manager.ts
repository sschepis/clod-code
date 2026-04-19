import * as vscode from 'vscode';
import { ChatPanel } from './chat-panel';
import type { Orchestrator } from '../agent/orchestrator';
import type { SessionStore, PanelMeta } from '../agent/session-store';
import { logger } from '../shared/logger';
import { generateChatName } from '../shared/name-generator';

export class ChatPanelManager {
  private panels = new Map<string, ChatPanel>();
  private counter = 0;
  private initialized = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly orchestrator: Orchestrator,
    private readonly sessionStore: SessionStore,
  ) {}

  openNew(label?: string): string {
    this.counter += 1;
    const panelId = `chat-${Date.now().toString(36)}-${this.counter}`;
    const displayLabel = label || generateChatName();

    const chatPanel = new ChatPanel(this.extensionUri, panelId, displayLabel);
    this.panels.set(panelId, chatPanel);

    chatPanel.onMessage((msg) => {
      this.orchestrator.handlePanelMessage(panelId, msg);
    });

    chatPanel.onDispose(() => {
      this.handlePanelClosed(panelId);
    });

    const bridge = this.orchestrator.getBridge();
    bridge.registerTarget(panelId, chatPanel);
    // Pre-create the slice so the webview's 'ready' message gets a valid sync
    // even before createInteractiveAgent completes its async work.
    bridge.ensureSlice(panelId, { provider: 'loading', model: 'initializing...', isLocal: false });

    this.orchestrator.createInteractiveAgent(panelId, displayLabel).catch((err) => {
      logger.error(`Failed to create interactive agent for panel ${panelId}`, err);
    });

    this.persistIndex();

    logger.info(`Chat panel opened: ${panelId} (${displayLabel})`);
    return panelId;
  }

  async restoreAll(): Promise<void> {
    this.initialized = true;

    // Create agents for all panels that the serializer already revived.
    // createInteractiveAgent is idempotent — safe to call even if
    // revivePanel already triggered it.
    for (const [panelId, chatPanel] of this.panels) {
      try {
        await this.orchestrator.createInteractiveAgent(panelId, chatPanel.label);
        logger.info(`Ensured agent for revived panel: ${panelId}`);
      } catch (err) {
        logger.warn(`Failed to create agent for revived panel ${panelId}`, err);
      }
    }
    this.persistIndex();
  }

  revivePanel(panelId: string, label: string, existingPanel: vscode.WebviewPanel): void {
    if (this.panels.has(panelId)) {
      logger.info(`Panel ${panelId} already exists — skipping duplicate revive`);
      return;
    }

    const chatPanel = new ChatPanel(this.extensionUri, panelId, label, existingPanel);
    this.panels.set(panelId, chatPanel);

    chatPanel.onMessage((msg) => {
      this.orchestrator.handlePanelMessage(panelId, msg);
    });

    chatPanel.onDispose(() => {
      this.handlePanelClosed(panelId);
    });

    const bridge = this.orchestrator.getBridge();
    bridge.registerTarget(panelId, chatPanel);
    bridge.ensureSlice(panelId, { provider: 'loading', model: 'initializing...', isLocal: false });

    // If restoreAll() already ran, create the agent now.
    // Otherwise restoreAll() will handle it after orchestrator init.
    if (this.initialized) {
      this.orchestrator.createInteractiveAgent(panelId, label).catch((err) => {
        logger.error(`Failed to create interactive agent for revived panel ${panelId}`, err);
      });
    }
    logger.info(`Revived panel: ${panelId}`);
  }

  close(panelId: string): void {
    const panel = this.panels.get(panelId);
    if (panel) {
      panel.dispose();
    }
  }

  getPanel(panelId: string): ChatPanel | undefined {
    return this.panels.get(panelId);
  }

  listPanels(): PanelMeta[] {
    return [...this.panels.entries()].map(([id, p]) => ({
      panelId: id,
      label: p.label,
      createdAt: 0,
      lastActiveAt: Date.now(),
    }));
  }

  getActivePanelId(): string | undefined {
    for (const [id, panel] of this.panels) {
      if (panel.isActive) return id;
    }
    return undefined;
  }

  focusPanel(panelId: string): void {
    this.panels.get(panelId)?.reveal();
  }

  renamePanel(panelId: string, title: string): void {
    const panel = this.panels.get(panelId);
    if (!panel) return;
    panel.setTitle(title);
    this.persistIndex();
  }

  disposeAll(): void {
    for (const [id, panel] of this.panels) {
      this.orchestrator.getBridge().unregisterTarget(id);
      try { panel.dispose(); } catch { /* ignore */ }
    }
    this.panels.clear();
  }

  private handlePanelClosed(panelId: string): void {
    this.panels.delete(panelId);
    this.orchestrator.getBridge().unregisterTarget(panelId);
    this.orchestrator.disposeInteractiveAgent(panelId).catch((err) => {
      logger.warn(`Failed to dispose interactive agent for panel ${panelId}`, err);
    });
    this.persistIndex();
    logger.info(`Chat panel closed: ${panelId}`);
  }

  private persistIndex(): void {
    const metas: PanelMeta[] = [...this.panels.entries()].map(([id, p]) => ({
      panelId: id,
      label: p.label,
      createdAt: 0,
      lastActiveAt: Date.now(),
    }));
    this.sessionStore.savePanelIndex(metas).catch((err) => {
      logger.warn('Failed to save panel index', err);
    });
  }
}
