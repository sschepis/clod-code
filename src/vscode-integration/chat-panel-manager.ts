import * as vscode from 'vscode';
import { ChatPanel } from './chat-panel';
import type { Orchestrator } from '../agent/orchestrator';
import type { SessionStore, PanelMeta } from '../agent/session-store';
import { logger } from '../shared/logger';

export class ChatPanelManager {
  private panels = new Map<string, ChatPanel>();
  private counter = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly orchestrator: Orchestrator,
    private readonly sessionStore: SessionStore,
  ) {}

  openNew(label?: string): string {
    this.counter += 1;
    const panelId = `chat-${Date.now().toString(36)}-${this.counter}`;
    const displayLabel = label || `Chat ${this.counter}`;

    const chatPanel = new ChatPanel(this.extensionUri, panelId, displayLabel);
    this.panels.set(panelId, chatPanel);

    chatPanel.onMessage((msg) => {
      this.orchestrator.handlePanelMessage(panelId, msg);
    });

    chatPanel.onDispose(() => {
      this.handlePanelClosed(panelId);
    });

    this.orchestrator.getBridge().registerTarget(panelId, chatPanel);

    this.orchestrator.createInteractiveAgent(panelId, displayLabel).catch((err) => {
      logger.error(`Failed to create interactive agent for panel ${panelId}`, err);
    });

    this.persistIndex();

    logger.info(`Chat panel opened: ${panelId} (${displayLabel})`);
    return panelId;
  }

  async restoreAll(): Promise<void> {
    const metas = await this.sessionStore.loadPanelIndex();
    for (const meta of metas) {
      try {
        const chatPanel = new ChatPanel(this.extensionUri, meta.panelId, meta.label);
        this.panels.set(meta.panelId, chatPanel);

        chatPanel.onMessage((msg) => {
          this.orchestrator.handlePanelMessage(meta.panelId, msg);
        });

        chatPanel.onDispose(() => {
          this.handlePanelClosed(meta.panelId);
        });

        this.orchestrator.getBridge().registerTarget(meta.panelId, chatPanel);

        await this.orchestrator.createInteractiveAgent(meta.panelId, meta.label);
        logger.info(`Restored chat panel: ${meta.panelId}`);
      } catch (err) {
        logger.warn(`Failed to restore chat panel ${meta.panelId}`, err);
      }
    }
  }

  revivePanel(panelId: string, label: string, existingPanel: vscode.WebviewPanel): void {
    const chatPanel = new ChatPanel(this.extensionUri, panelId, label, existingPanel);
    this.panels.set(panelId, chatPanel);

    chatPanel.onMessage((msg) => {
      this.orchestrator.handlePanelMessage(panelId, msg);
    });

    chatPanel.onDispose(() => {
      this.handlePanelClosed(panelId);
    });

    this.orchestrator.getBridge().registerTarget(panelId, chatPanel);

    this.orchestrator.createInteractiveAgent(panelId, label).catch((err) => {
      logger.error(`Failed to create interactive agent for revived panel ${panelId}`, err);
    });
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
