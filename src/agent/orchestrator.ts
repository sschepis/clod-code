/**
 * Orchestrator — thin coordinator that wires together:
 *   - AgentManager  (foreground + background agent lifecycle)
 *   - WebviewBridge (per-agent UI state + webview relay)
 *   - SessionStore  (foreground persistence)
 *   - UserPromptBridge (ask/secret pending-prompt tracking)
 *
 * Message routing:
 *   webview → Orchestrator.handleWebviewMessage
 *     ↳ dispatches to AgentManager / WebviewBridge / AgentHost as appropriate
 *   AgentHost events → WebviewBridge (per-agent slice relay)
 *   AgentManager summary updates → WebviewBridge (agents strip)
 */

import type { Session } from '@sschepis/as-agent';
import type { AgentRuntime } from '@sschepis/as-agent';

import type { SidebarProvider } from '../vscode-integration/sidebar-provider';
import type { ObotovsSettings } from '../config/settings';
import type {
  WebviewToExtMessage, ExtToWebviewMessage, SessionEvent,
  ObjectSnapshot, SurfaceInfo, RouteInfo, SkillInfo,
  MemoryInfo, ConversationInfo, ObjectCategory, ObjectActionKind,
} from '../shared/message-types';
import { FOREGROUND_AGENT_ID } from '../shared/message-types';

import { AgentHost } from './agent-host';
import { AgentManager } from './agent-manager';
import { WebviewBridge } from './webview-bridge';
import { buildToolTree } from './tool-tree';
import { SessionStore } from './session-store';
import { getUserPromptBridge } from './user-prompt-bridge';
import { getAgentRuntime } from './runtime';
import { SurfaceManager } from '../surfaces/surface-manager';
import type { SurfaceError } from '../surfaces/surface-panel';
import { RouteManager } from '../routes/route-manager';
import { SkillManager } from '../skills/skill-manager';
import { PeerManager } from '../peers/peer-manager';
import { DispatchRegistry } from '../peers/dispatch-registry';
import { PeerAskRegistry } from '../peers/peer-ask-registry';
import { MemoryManager } from './memory/memory-manager';
import type { AgentSyncMonitor } from './sync';
import * as vscode from 'vscode';
import * as path from 'path';
import type {
  DispatchRequestBody, DispatchResponseBody, DispatchStatusBody,
  AskRequestBody, AskResponseBody, AskStatusBody,
  CancelRequestBody, CancelResponseBody,
} from '../peers/peer-server';

import { logger } from '../shared/logger';
import { MAX_ATTACHMENT_TEXT_LENGTH } from '../shared/constants';
import { SpeechToText } from '../audio/speech-to-text';

const PLAN_MODE_PREAMBLE =
  `[PLAN MODE — DO NOT write code, edit files, or make any changes. ` +
  `Your only permitted tools are search/grep, search/glob, and file/read. ` +
  `Do NOT use file/write, file/edit, shell/run, or any tool that modifies state.\n\n` +

  `## Your Goal\n` +
  `Produce an implementation plan so detailed and unambiguous that a developer (or AI) could execute it ` +
  `with zero questions, zero guesswork, and zero need to re-explore the codebase.\n\n` +

  `## Phase 1 — Deep Exploration (spend the majority of your effort here)\n` +
  `Before writing a single line of plan, exhaustively explore every part of the codebase that the task touches. ` +
  `The most common planning failure is a shallow read — you MUST go deep.\n\n` +
  `For each area the task involves:\n` +
  `1. Read the FULL file, not just the function you think matters. Understand the surrounding code, imports, ` +
  `   exports, and how other callers use it.\n` +
  `2. Trace call chains end-to-end. If the task changes a function, find every caller and every callee. ` +
  `   If it changes a type, find every usage. If it changes a message, trace it from sender to receiver.\n` +
  `3. Search for existing patterns. Before proposing new code, grep for similar functionality that already ` +
  `   exists — existing utilities, helpers, constants, hooks, or abstractions you should reuse.\n` +
  `4. Read test files for the code you're planning to change. Understand what's covered and what test ` +
  `   patterns the project uses.\n` +
  `5. Check for conventions. Read 2-3 similar files to understand naming, file organization, import style, ` +
  `   error handling patterns, and architectural boundaries the project follows.\n` +
  `6. Identify shared types and interfaces. Read the type definitions that will be affected and understand ` +
  `   their full shape, not just the fields you plan to add.\n\n` +

  `## Phase 2 — Produce the Plan\n` +
  `Structure your plan as follows:\n\n` +

  `### Context\n` +
  `Explain in 2-3 sentences why this change is being made and what outcome the user wants.\n\n` +

  `### Files to Modify\n` +
  `For EACH file, provide:\n` +
  `- **File path** and a one-line summary of why it's changing\n` +
  `- **Exact location**: the function/class/block being modified, with line numbers from your read\n` +
  `- **Current code**: quote the specific lines being changed (not the whole file, just the change site)\n` +
  `- **What to change**: describe the modification precisely — new parameters, new branches, new imports, ` +
  `  renamed fields, added/removed lines. Be specific enough that the implementer doesn't need to re-read ` +
  `  the file to understand the edit.\n` +
  `- **Reuse**: name any existing functions, types, constants, or patterns from the codebase that should be ` +
  `  used, with their file paths. Never propose creating something that already exists.\n\n` +

  `### New Files (if any)\n` +
  `For each new file:\n` +
  `- **File path** and purpose\n` +
  `- **Exports**: what it exports and who will import it\n` +
  `- **Key logic**: describe the core implementation — not pseudocode, but a clear specification of behavior, ` +
  `  edge cases, and how it integrates with existing code\n` +
  `- **Patterns to follow**: reference an existing file in the project that this new file should mirror in ` +
  `  style and structure\n\n` +

  `### Integration Points\n` +
  `Describe how the changes connect across files — message flow, type propagation, import chains, ` +
  `event wiring. This is where plans most often fail: the individual file changes are correct but ` +
  `they don't connect properly.\n\n` +

  `### Edge Cases & Risks\n` +
  `List specific things that could go wrong and how the plan accounts for them.\n\n` +

  `### Verification\n` +
  `Numbered steps to test the change end-to-end — build commands, manual test steps, what to check.\n\n` +

  `### Parallel Opportunities\n` +
  `Identify which file changes or steps from the plan above are independent and could run in parallel ` +
  `using agent/batch. Group them into parallel batches. Example:\n` +
  `- Batch 1 (parallel): types.ts + constants.ts (no dependency between them)\n` +
  `- Sequential: handler.ts (depends on types.ts)\n` +
  `- Batch 2 (parallel): test-handler.test.ts + test-types.test.ts\n` +
  `If the plan is simple enough that everything is sequential, say so and explain why.\n\n` +

  `## Rules\n` +
  `- Do NOT hand-wave. "Update the handler to support X" is not a plan — specify which handler, ` +
  `  what the current code looks like, and exactly what changes.\n` +
  `- Do NOT propose abstractions, refactors, or cleanups beyond what the task requires.\n` +
  `- Do NOT guess at code structure. If you're unsure, read more files before writing the plan.\n` +
  `- Every file path, function name, and type name in your plan must come from an actual read — ` +
  `  never from memory or assumption.]\n\n`;

function wrapPlanMode(text: string): string {
  return PLAN_MODE_PREAMBLE + text;
}

function truncateForMemory(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return '';
  return trimmed.length <= MAX_ATTACHMENT_TEXT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_ATTACHMENT_TEXT_LENGTH)}…`;
}

export class Orchestrator {
  private sidebar: SidebarProvider;
  private sessionStore: SessionStore;
  private settings: ObotovsSettings;
  private extensionPath: string;
  private agentRuntime?: AgentRuntime;

  private bridge: WebviewBridge;
  private manager: AgentManager;
  private readonly routeManager: RouteManager;
  private readonly surfaceManager: SurfaceManager;
  private readonly skillManager: SkillManager;
  private readonly peerManager: PeerManager;
  private readonly dispatches: DispatchRegistry;
  private readonly peerAsks: PeerAskRegistry;
  private readonly windowId: string;
  private memoryManager?: MemoryManager;
  private syncMonitor?: AgentSyncMonitor;
  private surfaceFixCooldowns = new Map<string, number>();
  private objectsWatcher?: vscode.FileSystemWatcher;
  private objectsBroadcastTimer?: NodeJS.Timeout;
  private memoryChangeUnsubscribe?: () => void;
  private panelRenamer?: (panelId: string, title: string) => void;
  private chatPanelOpener?: () => void;
  private panelRevealer?: (panelId: string) => void;
  private speechToText?: SpeechToText;
  private summaryListeners: Array<() => void> = [];
  private uiEventsSaveTimers = new Map<string, NodeJS.Timeout>();
  private foregroundReady = false;
  private pendingSidebarSync = false;

  constructor(
    sidebar: SidebarProvider,
    sessionStore: SessionStore,
    settings: ObotovsSettings,
    extensionPath: string,
    windowId: string,
    extensionContext?: vscode.ExtensionContext,
  ) {
    this.sidebar = sidebar;
    this.sessionStore = sessionStore;
    this.settings = settings;
    this.extensionPath = extensionPath;
    this.windowId = windowId;

    this.bridge = new WebviewBridge();
    this.bridge.registerTarget('sidebar', sidebar);
    if (extensionContext) {
      this.memoryManager = new MemoryManager(extensionContext);
      this.speechToText = new SpeechToText(extensionContext.globalStorageUri.fsPath);
      this.speechToText.setCallbacks({
        onStatusChange: (status, message) => {
          this.bridge.post({ type: 'recording_status', status, message });
        },
        onTranscript: (text) => {
          this.bridge.post({ type: 'recording_transcript', text });
        },
        onError: (error) => {
          this.bridge.post({ type: 'recording_error', error });
        },
      });
    }

    // Workspace-scoped managers — shared across foreground + background agents.
    this.routeManager = new RouteManager({
      windowId: this.windowId,
      onBaseUrlChange: (url) => this.surfaceManager.broadcastRoutesUrl(url),
    });
    this.surfaceManager = new SurfaceManager({
      isAutoOpenEnabled: () => this.settings.surfacesAutoOpen,
      getRoutesUrl: () => this.routeManager.baseUrl(),
      onSurfaceError: (error) => this.handleSurfaceAutoFix(error),
      onSubmitToAgent: (text, agentId) => {
        const target = agentId || 'foreground';
        this.submitToAgent(target, text);
        // Reveal the chat panel if submitting to foreground
        if (target === 'foreground') {
          vscode.commands.executeCommand('obotovs.chatPanel.focus');
        }
      },
      onExecuteTool: async (tool, kwargs) => {
        // Route tool execution through the foreground agent's tool tree
        const agent = this.manager.getForeground();
        if (!agent) throw new Error('No foreground agent available to execute tools');
        const toolObj = agent.tools.getTool(tool);
        if (!toolObj) throw new Error(`Tool not found: ${tool}`);
        return await toolObj.handler(kwargs);
      },
    });
    this.skillManager = new SkillManager();
    this.dispatches = new DispatchRegistry();
    this.peerAsks = new PeerAskRegistry();
    this.peerManager = new PeerManager(
      () => this.manager.listAll(),
      {
        onPeersChanged: (peers) => {
          this.bridge.post({
            type: 'peers_update',
            peers: peers.map((p) => ({
              windowId: p.windowId,
              pid: p.pid,
              startedAt: p.startedAt,
              lastSeen: p.lastSeen,
              agents: p.agents,
            })),
          });
        },
        onDispatchReceived: (req) => this.handleIncomingDispatch(req),
        getDispatchStatus: (rpcId) => this.readDispatchStatus(rpcId),
        onAskReceived: (req) => this.handleIncomingAsk(req),
        getAskStatus: (rpcId) => this.readAskStatus(rpcId),
        onCancelReceived: (req) => this.handleIncomingCancel(req),
        onOutboundChanged: (outbound) => {
          this.bridge.post({
            type: 'outbound_dispatches_update',
            dispatches: outbound.map((o) => ({
              rpcId: o.rpcId,
              peerWindowId: o.peerWindowId,
              label: o.label,
              task: o.task,
              status: o.status,
              sentAt: o.sentAt,
              completedAt: o.completedAt,
              result: o.result,
              error: o.error,
              reason: o.reason,
            })),
          });
        },
      },
    );

    // AgentManager needs a tool-tree factory. For the foreground we pass an
    // agent-deps object that references `this.manager` — so we initialize
    // the manager first with a placeholder factory and patch it below.
    this.manager = new AgentManager({
      settings,
      agentRuntime: undefined,
      toolTreeFactory: (agentId) => this.buildToolTreeFor(agentId),
      bridge: this.bridge,
      skills: this.skillManager,
      onSummariesChanged: () => {
        this.peerManager.notifyLocalAgentsChanged();
        this.scheduleObjectsBroadcast();
        for (const cb of this.summaryListeners) {
          try { cb(); } catch { /* best-effort */ }
        }
      },
      onAgentSpawned: (agentId, host, parentId) => {
        if (this.memoryManager) {
          this.memoryManager.snapshotForSpawn(parentId ?? FOREGROUND_AGENT_ID, agentId);
        }
        this.attachMemoryAutoCapture(agentId, host);
        this.syncMonitor?.registerAgent(agentId);
        this.attachSyncCapture(agentId, host);
      },
    });

    // Handle messages from webview
    sidebar.onMessage((msg) => this.handleWebviewMessage(msg));

    // Debounced UI events save — fires on every slice change (token, event, tool status, etc.)
    this.bridge.onSliceChanged((agentId) => this.scheduleUiEventsSave(agentId));

    this.installObjectsWatcher();
  }

  private replaySidebarSync(): void {
    const focused = this.bridge.getFocus();
    this.bridge.sendSync(focused);
    this.broadcastObjects();
    this.bridge.post({
      type: 'peers_update',
      peers: this.peerManager.listPeers().map((p) => ({
        windowId: p.windowId,
        pid: p.pid,
        startedAt: p.startedAt,
        lastSeen: p.lastSeen,
        agents: p.agents,
      })),
    });
    this.bridge.post({
      type: 'outbound_dispatches_update',
      dispatches: this.peerManager.listOutbound().map((o) => ({
        rpcId: o.rpcId,
        peerWindowId: o.peerWindowId,
        label: o.label,
        task: o.task,
        status: o.status,
        sentAt: o.sentAt,
        completedAt: o.completedAt,
        result: o.result,
        error: o.error,
        reason: o.reason,
      })),
    });
  }

  private scheduleUiEventsSave(agentId: string): void {
    const existing = this.uiEventsSaveTimers.get(agentId);
    if (existing) clearTimeout(existing);
    this.uiEventsSaveTimers.set(agentId, setTimeout(() => {
      this.uiEventsSaveTimers.delete(agentId);
      const slice = this.bridge.getSlice(agentId);
      if (!slice) return;
      if (agentId === FOREGROUND_AGENT_ID) {
        this.sessionStore.saveUiEvents(slice.events).catch(err => {
          logger.warn('Debounced UI events save failed', err);
        });
      } else if (this.manager.isInteractive(agentId)) {
        this.sessionStore.savePanelUiEvents(agentId, slice.events).catch(err => {
          logger.warn(`Debounced panel UI events save failed for ${agentId}`, err);
        });
      }
    }, 1000));
  }

  /** Exposed for the `obotovs.openSurface` command. */
  getSurfaceManager(): SurfaceManager { return this.surfaceManager; }

  /** Exposed for the `/peers` slash command. */
  getPeerManager(): PeerManager { return this.peerManager; }

  // ── Incoming dispatch handling ─────────────────────────────────────

  private handleIncomingDispatch(req: DispatchRequestBody): DispatchResponseBody | null {
    if (!this.settings.peerDispatchEnabled) return null;
    const label = (req.label ?? req.task).trim().slice(0, 60) || 'Peer task';
    const rec = this.dispatches.create({
      fromWindowId: req.fromWindowId,
      task: req.task,
      label,
    });
    // Show an approval prompt in the foreground slice. The promptId is the
    // same rpcId so the webview response can resolve the registry entry.
    this.bridge.appendEvent(FOREGROUND_AGENT_ID, {
      id: `peer-dispatch-${rec.rpcId}`,
      role: 'peer_dispatch_request',
      promptId: rec.rpcId,
      fromWindowId: rec.fromWindowId,
      task: rec.task,
      label: rec.label,
      status: 'pending',
      timestamp: now(),
    });
    this.bridge.post({
      type: 'peer_dispatch_request',
      agentId: FOREGROUND_AGENT_ID,
      promptId: rec.rpcId,
      fromWindowId: rec.fromWindowId,
      task: rec.task,
      label: rec.label,
    });
    return { rpcId: rec.rpcId };
  }

  private readDispatchStatus(rpcId: string): DispatchStatusBody | null {
    const rec = this.dispatches.get(rpcId);
    if (!rec) return null;
    return {
      status: rec.status,
      result: rec.result,
      error: rec.error,
      reason: rec.reason,
      cost: rec.cost,
      completedAt: rec.completedAt,
    };
  }

  private handleIncomingAsk(req: AskRequestBody): AskResponseBody | null {
    if (!this.settings.peerDispatchEnabled) return null;
    const rec = this.peerAsks.create({
      fromWindowId: req.fromWindowId,
      question: req.question,
      choices: req.choices,
      defaultChoice: req.defaultChoice,
      inputMode: req.inputMode,
    });
    const displayQuestion = `[from peer ${rec.fromWindowId.slice(0, 8)}]\n\n${rec.question}`;
    // Append a `question` event to the foreground slice using the rpcId as
    // the promptId. When the user answers via QuestionPrompt, the resulting
    // `ask_question_response` will be routed to the peer-ask registry
    // because the local UserPromptBridge has no entry for this id.
    this.bridge.appendEvent(FOREGROUND_AGENT_ID, {
      id: `peer-ask-${rec.rpcId}`,
      role: 'question',
      promptId: rec.rpcId,
      question: displayQuestion,
      choices: rec.choices,
      defaultChoice: rec.defaultChoice,
      inputMode: rec.inputMode,
      status: 'pending',
      timestamp: now(),
    });
    this.bridge.post({
      type: 'ask_question',
      agentId: FOREGROUND_AGENT_ID,
      promptId: rec.rpcId,
      question: displayQuestion,
      choices: rec.choices,
      defaultChoice: rec.defaultChoice,
      inputMode: rec.inputMode,
    });
    return { rpcId: rec.rpcId };
  }

  private readAskStatus(rpcId: string): AskStatusBody | null {
    const rec = this.peerAsks.get(rpcId);
    if (!rec) return null;
    return {
      status: rec.status,
      answerIndex: rec.answerIndex,
      answerText: rec.answerText,
      reason: rec.reason,
      completedAt: rec.completedAt,
    };
  }

  private handleIncomingCancel(req: CancelRequestBody): CancelResponseBody {
    const rec = this.dispatches.get(req.rpcId);
    if (!rec) return { ok: false, reason: 'no such rpcId' };
    // Only the peer that originated the dispatch can cancel it.
    if (rec.fromWindowId !== req.fromWindowId) {
      return { ok: false, reason: 'not owner of this dispatch' };
    }
    if (rec.status === 'completed' || rec.status === 'error' ||
        rec.status === 'cancelled' || rec.status === 'rejected') {
      return { ok: false, reason: `already ${rec.status}` };
    }
    if (rec.agentId) {
      void this.manager.cancel(rec.agentId, 'Cancelled by originating peer.');
      // The spawn's waitForCompletion watcher will finalize + broadcast.
      return { ok: true };
    }
    // Still pending approval — mark as cancelled directly.
    this.finalizeDispatch(req.rpcId, {
      status: 'cancelled',
      reason: 'Cancelled by originating peer before approval.',
    });
    return { ok: true };
  }

  /** Update a dispatch record and push SSE notification to the originating peer. */
  private finalizeDispatch(rpcId: string, patch: Partial<import('../peers/dispatch-registry').DispatchRecord>): void {
    const completedAt = Date.now();
    const updated = this.dispatches.update(rpcId, { ...patch, completedAt });
    if (!updated) return;
    this.peerManager.notifyDispatchResolved({
      rpcId: updated.rpcId,
      status: updated.status,
      result: updated.result,
      error: updated.error,
      reason: updated.reason,
      completedAt,
    });
  }

  private async onPeerDispatchResponse(promptId: string, approved: boolean): Promise<void> {
    const rec = this.dispatches.get(promptId);
    if (!rec) return;
    // Update the pending event in the webview.
    this.bridge.patchEvent(
      FOREGROUND_AGENT_ID,
      (e) => e.role === 'peer_dispatch_request' && (e as any).promptId === promptId,
      { status: approved ? 'approved' : 'rejected' } as any,
    );
    this.bridge.post({
      type: 'peer_dispatch_resolved',
      agentId: FOREGROUND_AGENT_ID,
      promptId,
      status: approved ? 'approved' : 'rejected',
    });

    if (!approved) {
      this.finalizeDispatch(promptId, {
        status: 'rejected',
        reason: 'User denied the dispatch.',
      });
      return;
    }

    // Approved → spawn a background agent to run the task.
    const spawn = await this.manager.spawn({
      task: rec.task,
      label: rec.label,
    });
    if (!spawn.ok) {
      this.finalizeDispatch(promptId, {
        status: 'error',
        error: spawn.error,
      });
      return;
    }

    this.dispatches.update(promptId, {
      agentId: spawn.agentId,
      status: 'running',
    });
    // Tell the originating peer so its outbound UI flips from
    // `pending_approval` to `running` promptly.
    this.peerManager.notifyDispatchResolved({
      rpcId: promptId,
      status: 'running',
    });

    // Await completion and update the registry.
    this.manager.waitForCompletion(spawn.agentId).then((result) => {
      const existing = this.dispatches.get(promptId);
      if (!existing) return;
      const status =
        result.status === 'complete' ? 'completed' :
        result.status === 'cancelled' ? 'cancelled' :
        'error';
      this.finalizeDispatch(promptId, {
        status,
        result: result.result,
        error: result.error,
      });
    });
  }

  /** Initialize the foreground agent. Call once after construction. */
  async initialize(): Promise<void> {
    // Load WASM runtime (optional, non-fatal)
    try {
      this.agentRuntime = await getAgentRuntime(this.extensionPath);
      this.manager.setAgentRuntime(this.agentRuntime);
      logger.info('WASM runtime loaded');
    } catch (err) {
      logger.warn('WASM runtime not available — slash commands will be limited', err);
    }

    // Hierarchical memory (non-fatal if it fails — agent still works)
    if (this.memoryManager) {
      try {
        await this.memoryManager.init();
        this.memoryChangeUnsubscribe = this.memoryManager.onDidChange(() => this.scheduleObjectsBroadcast());
      } catch (err) {
        logger.warn('Memory init failed — memory tools will be unavailable', err);
        this.memoryManager = undefined;
      }
    }

    // Kuramoto cross-agent sync monitor (non-fatal)
    try {
      const { AgentSyncMonitor: SyncCtor } = await import('./sync');
      this.syncMonitor = await SyncCtor.create((metrics) => {
        this.bridge.post({ type: 'sync_update', metrics });
      });
    } catch (err) {
      logger.warn('Sync monitor init failed — cross-agent sync will be unavailable', err);
    }

    await this.createForeground();

    // Start peer presence last so `listAll()` picks up the foreground agent
    // in the initial hello broadcast.
    try {
      await this.peerManager.start();
    } catch (err) {
      logger.warn('peer manager start failed — continuing without peer presence', err);
    }
  }

  /** Recreate the foreground agent with new settings. */
  async recreateAgent(newSettings?: ObotovsSettings): Promise<void> {
    if (newSettings) {
      this.settings = newSettings;
      this.manager.updateSettings(newSettings);
    }
    await this.manager.recreateForeground(this.settings);
  }

  getSession(): Session | undefined {
    return this.manager.getForeground()?.getSession();
  }

  async submitToAgent(agentId: string, text: string): Promise<void> {
    this.bridge.appendEvent(agentId, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: now(),
    });
    const host =
      agentId === FOREGROUND_AGENT_ID
        ? this.manager.getForeground()
        : this.manager.get(agentId)?.host;
    if (host) {
      await host.submit(text);
    } else {
      logger.warn(`submitToAgent ignored — agent "${agentId}" not available`);
    }
  }

  /**
   * Send a message from one agent to another in the same window.
   * By default waits for the target to finish responding and returns the response.
   */
  private async sendInterAgentMessage(
    callerId: string,
    targetId: string,
    message: string,
    awaitResponse: boolean,
  ): Promise<string> {
    // Resolve caller label
    const callerRec = this.manager.get(callerId);
    const callerLabel = callerRec?.summary.label ?? callerId;

    // Resolve target host
    const targetHost =
      targetId === FOREGROUND_AGENT_ID
        ? this.manager.getForeground()
        : this.manager.get(targetId)?.host;
    if (!targetHost) {
      throw new Error(`Agent "${targetId}" not found or not available.`);
    }

    const formattedMessage = `[Message from ${callerLabel}]: ${message}`;

    // Record pre-submission event count so we can collect the response later
    const slice = this.bridge.getSlice(targetId);
    const preCount = slice?.events.length ?? 0;

    // Add the message to the target's UI and submit it for processing
    this.bridge.appendEvent(targetId, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: formattedMessage,
      timestamp: now(),
    });

    if (!awaitResponse) {
      // Fire and forget — submit asynchronously
      targetHost.submit(formattedMessage).catch((err) => {
        logger.warn(`async inter-agent message delivery failed: ${err}`);
      });
      return `[SENT] Message delivered to ${targetId}. The target agent will process it asynchronously.`;
    }

    // Synchronous: wait for the target to finish responding
    const responsePromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        unsub();
        resolve('[TIMEOUT] Target agent did not respond within 120 seconds.');
      }, 120_000);

      const unsub = targetHost.on((event) => {
        if (event.type === 'turn_complete') {
          clearTimeout(timeout);
          unsub();
          // Collect assistant response events added after our message
          const currentSlice = this.bridge.getSlice(targetId);
          if (!currentSlice) {
            resolve('[ERROR] Target agent slice not found.');
            return;
          }
          const newEvents = currentSlice.events.slice(preCount + 1); // +1 to skip the UserEvent we added
          const assistantTexts = newEvents
            .filter((e) => e.role === 'assistant')
            .map((e) => (e as any).content as string)
            .filter(Boolean);
          if (assistantTexts.length > 0) {
            resolve(assistantTexts.join('\n'));
          } else {
            resolve('[INFO] Target agent processed the message but produced no text response.');
          }
        }
      });
    });

    // Kick off processing (don't await — the event listener handles completion)
    targetHost.submit(formattedMessage).catch((err) => {
      logger.warn(`inter-agent message submit failed: ${err}`);
    });

    return responsePromise;
  }

  dispose(): void {
    // Flush any pending UI event saves immediately before tearing down
    for (const [agentId, timer] of this.uiEventsSaveTimers.entries()) {
      clearTimeout(timer);
      const slice = this.bridge.getSlice(agentId);
      if (slice) {
        if (agentId === FOREGROUND_AGENT_ID) {
          void this.sessionStore.saveUiEvents(slice.events);
        } else if (this.manager.isInteractive(agentId)) {
          void this.sessionStore.savePanelUiEvents(agentId, slice.events);
        }
      }
    }
    this.uiEventsSaveTimers.clear();

    this.speechToText?.dispose();
    void this.peerManager.stop();
    void this.routeManager.stop();
    this.surfaceManager.dispose();
    this.skillManager.dispose();
    this.dispatches.dispose();
    this.peerAsks.dispose();
    void this.manager.dispose();
    this.sessionStore.dispose();
    if (this.memoryManager) void this.memoryManager.dispose();
    this.syncMonitor?.dispose();
    if (this.memoryChangeUnsubscribe) this.memoryChangeUnsubscribe();
    if (this.objectsBroadcastTimer) clearTimeout(this.objectsBroadcastTimer);
    this.objectsWatcher?.dispose();
  }

  // ── Public accessors for ChatPanelManager ───────────────────────────

  getBridge(): WebviewBridge { return this.bridge; }

  setPanelRenamer(renamer: (panelId: string, title: string) => void): void {
    this.panelRenamer = renamer;
  }

  setChatPanelOpener(opener: () => void): void {
    this.chatPanelOpener = opener;
  }

  setPanelRevealer(revealer: (panelId: string) => void): void {
    this.panelRevealer = revealer;
  }

  getAgentSummaries(): import('../shared/message-types').AgentSummary[] {
    return this.manager.listAll();
  }

  async cancelAgent(agentId: string): Promise<void> {
    await this.manager.cancel(agentId, 'Cancelled from explorer');
  }

  onSummariesChanged(cb: () => void): void {
    this.summaryListeners.push(cb);
  }

  async createInteractiveAgent(panelId: string, label?: string): Promise<void> {
    if (this.manager.get(panelId)) {
      logger.info(`Interactive agent "${panelId}" already exists — skipping duplicate creation`);
      return;
    }
    const { router } = this.buildToolTreeFor(panelId);
    const session = (await this.sessionStore.loadPanel(panelId)) ?? undefined;

    if (this.memoryManager) {
      try {
        const memJson = await this.sessionStore.loadPanelMemory(panelId);
        if (memJson) this.memoryManager.loadConversation(panelId, memJson as any);
      } catch (err) {
        logger.warn(`Failed to load panel memory for ${panelId}`, err);
      }
    }

    const host = new AgentHost({
      id: panelId,
      settings: this.settings,
      router,
      agentRuntime: this.agentRuntime,
      initialSession: session,
      skills: this.skillManager,
    });

    this.manager.registerInteractive(panelId, host);
    await host.initialize(session);

    // Restore saved UI events into the bridge slice
    try {
      const savedEvents = await this.sessionStore.loadPanelUiEvents(panelId);
      if (savedEvents && Array.isArray(savedEvents) && savedEvents.length > 0) {
        const slice = this.bridge.getSlice(panelId);
        if (slice) {
          slice.events = savedEvents as any;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load panel UI events for ${panelId}`, err);
    }

    // Agent is ready — push a full sync so the panel webview picks up the
    // real model info and any restored session events.
    this.bridge.sendSync(panelId, panelId);

    host.on((event) => {
      if (event.type === 'turn_complete') {
        const s = host.getSession();
        if (s) this.sessionStore.scheduleSavePanel(panelId, s);
        const slice = this.bridge.getSlice(panelId);
        if (slice) {
          this.sessionStore.savePanelUiEvents(panelId, slice.events).catch(err => {
            logger.warn(`Panel UI events save failed for ${panelId}`, err);
          });
        }
        if (this.memoryManager) {
          this.memoryManager.scheduleFlush();
          const mem = this.memoryManager.serializeConversation(panelId);
          if (mem) {
            this.sessionStore.savePanelMemory(panelId, mem).catch(err => {
              logger.warn(`Panel memory save failed for ${panelId}`, err);
            });
          }
        }
      }
    });

    this.attachMemoryAutoCapture(panelId, host);
    this.syncMonitor?.registerAgent(panelId);
    this.attachSyncCapture(panelId, host);
  }

  async disposeInteractiveAgent(panelId: string): Promise<void> {
    const host = this.manager.get(panelId)?.host;
    if (host) {
      const session = host.getSession();
      if (session) {
        await this.sessionStore.savePanel(panelId, session);
      }
    }
    this.manager.disposeInteractive(panelId);
  }

  handlePanelMessage(panelId: string, msg: WebviewToExtMessage): void {
    const patched = { ...msg, agentId: panelId } as any;
    if (msg.type === 'ready') {
      patched.panelAgentId = panelId;
    }
    if (msg.type === 'focus_agent' || msg.type === 'cancel_agent') {
      patched.agentId = (msg as any).agentId;
    }
    void this.handleWebviewMessage(patched as WebviewToExtMessage);
  }

  // ── Foreground creation ─────────────────────────────────────────────

  private async createForeground(): Promise<void> {
    const { router } = this.buildToolTreeFor(FOREGROUND_AGENT_ID);
    const session = (await this.sessionStore.load()) ?? undefined;

    // Load conversation memory for the foreground agent (if any was saved)
    if (this.memoryManager) {
      try {
        const memJson = await this.sessionStore.loadMemory();
        if (memJson) this.memoryManager.loadConversation(FOREGROUND_AGENT_ID, memJson as any);
      } catch (err) {
        logger.warn('Failed to load conversation memory', err);
      }
    }

    const host = new AgentHost({
      id: FOREGROUND_AGENT_ID,
      settings: this.settings,
      router,
      agentRuntime: this.agentRuntime,
      initialSession: session,
      skills: this.skillManager,
    });

    this.manager.registerForeground(host);
    await host.initialize(session);

    // Restore saved UI events into the bridge slice so the chat shows history
    try {
      const savedEvents = await this.sessionStore.loadUiEvents();
      if (savedEvents && Array.isArray(savedEvents) && savedEvents.length > 0) {
        const slice = this.bridge.getSlice(FOREGROUND_AGENT_ID);
        if (slice) {
          slice.events = savedEvents as any;
        }
      }
    } catch (err) {
      logger.warn('Failed to load UI events', err);
    }

    // Foreground is now fully initialized with restored events.
    // If the sidebar sent 'ready' before we got here, replay the sync now.
    this.foregroundReady = true;
    if (this.pendingSidebarSync) {
      this.pendingSidebarSync = false;
      this.replaySidebarSync();
    }

    // Persist foreground session + conversation memory on turn_complete
    host.on((event) => {
      if (event.type === 'turn_complete') {
        const s = host.getSession();
        if (s) this.sessionStore.scheduleSave(s);
        if (this.memoryManager) {
          this.memoryManager.scheduleFlush();
          const mem = this.memoryManager.serializeConversation(FOREGROUND_AGENT_ID);
          if (mem) {
            this.sessionStore.saveMemory(mem).catch(err => {
              logger.warn('Memory save failed', err);
            });
          }
        }
      }
    });

    // Auto-capture tool completions into conversation memory
    this.attachMemoryAutoCapture(FOREGROUND_AGENT_ID, host);

    // Register foreground with Kuramoto sync monitor
    this.syncMonitor?.registerAgent(FOREGROUND_AGENT_ID);
    this.attachSyncCapture(FOREGROUND_AGENT_ID, host);

    // Register custom slash commands
    this.registerSlashCommands();
  }

  /**
   * Subscribe to an agent's tool_complete events and record low-strength
   * entries into the conversation memory. The LLM can later promote
   * noteworthy entries. Publicly accessible so AgentManager can call it
   * for spawned agents after they're built.
   */
  attachMemoryAutoCapture(agentId: string, host: AgentHost): void {
    if (!this.memoryManager) return;
    const mem = this.memoryManager;
    host.on((event) => {
      if (event.type !== 'tool_complete') return;
      if (event.error) return; // only capture successful runs
      const body = truncateForMemory(event.result ?? '');
      if (!body) return;
      const rootName = event.command.split(/[\s.]/)[0] ?? event.command;
      mem.recordConversationEntry(agentId, {
        title: `tool:${event.command}`,
        body,
        tags: [rootName],
        strength: 0.2,
      });
    });
  }

  private attachSyncCapture(agentId: string, host: AgentHost): void {
    if (!this.syncMonitor) return;
    const monitor = this.syncMonitor;
    host.on((event) => {
      if (event.type === 'tool_complete' && !event.error) {
        const text = (event.result ?? '').trim();
        if (text) monitor.ingestContent(agentId, text);
      }
      if (event.type === 'disposed') {
        monitor.unregisterAgent(agentId);
      }
    });
  }

  /** Expose the MemoryManager so AgentManager can snapshot on spawn. */
  getMemoryManager(): MemoryManager | undefined { return this.memoryManager; }

  // ── Tool tree factory ───────────────────────────────────────────────

  private buildToolTreeFor(agentId: string): ReturnType<typeof buildToolTree> {
    const bridge = getUserPromptBridge();

    const post = (msg: ExtToWebviewMessage) => {
      // Tag with agentId if the message has an agentId slot and none was set.
      // We narrow via a small helper; agentId is optional on most messages.
      if ('agentId' in (msg as any)) {
        const m = msg as { agentId?: string };
        if (!m.agentId) m.agentId = agentId;
      }
      this.bridge.post(msg);
    };

    // Event appends/resolves for user/ask and user/secret must land on the
    // correct slice. Use the bridge's appendEvent / patchEvent.
    const ask = {
      bridge,
      post,
      createEvent: (e: {
        id: string;
        promptId: string;
        question: string;
        choices: string[];
        defaultChoice?: number;
      }) => {
        this.bridge.appendEvent(agentId, {
          id: e.id,
          role: 'question',
          promptId: e.promptId,
          question: e.question,
          choices: e.choices,
          defaultChoice: e.defaultChoice,
          status: 'pending',
          timestamp: now(),
        });
      },
      resolveEvent: (promptId: string, result: {
        status: 'answered' | 'cancelled';
        answerIndex?: number;
        answerText?: string;
      }) => {
        this.bridge.patchEvent(
          agentId,
          (e) => e.role === 'question' && (e as any).promptId === promptId,
          result as any,
        );
      },
    };

    const secret = {
      bridge,
      post,
      createEvent: (e: {
        id: string;
        promptId: string;
        name: string;
        description?: string;
        envPath: string;
      }) => {
        this.bridge.appendEvent(agentId, {
          id: e.id,
          role: 'secret_request',
          promptId: e.promptId,
          name: e.name,
          description: e.description,
          envPath: e.envPath,
          status: 'pending',
          timestamp: now(),
        });
      },
      resolveEvent: (promptId: string, result: {
        status: 'answered' | 'cancelled';
        savedToFile?: boolean;
      }) => {
        this.bridge.patchEvent(
          agentId,
          (e) => e.role === 'secret_request' && (e as any).promptId === promptId,
          result as any,
        );
      },
    };

    // Foreground, interactive, and depth-eligible background agents can spawn sub-agents.
    const agentDeps =
      agentId === FOREGROUND_AGENT_ID || this.manager.isInteractive(agentId) || this.manager.canSpawnChildren(agentId)
        ? { manager: this.manager, callerId: () => agentId }
        : undefined;

    const chatTitle = {
      setTitle: (title: string) => {
        this.bridge.updateSummary(agentId, { label: title });
        this.bridge.post({ type: 'title_changed', agentId, title });
        this.panelRenamer?.(agentId, title);
      },
    };

    return buildToolTree({
      ask,
      secret,
      agent: agentDeps,
      surface: { manager: this.surfaceManager },
      route: { manager: this.routeManager },
      skill: { manager: this.skillManager },
      peer: {
        manager: this.peerManager,
        callerAgentId: agentId,
        sendMessageToAgent: (callerId, targetId, message, awaitResponse) =>
          this.sendInterAgentMessage(callerId, targetId, message, awaitResponse),
      },
      memory: this.memoryManager
        ? { manager: this.memoryManager, callerId: () => agentId }
        : undefined,
      chatTitle,
      shell: { getShell: () => this.settings.shell },
      tts: {
        getApiKey: () => process.env.ELEVENLABS_API_KEY,
      },
    });
  }

  // ── Webview message handling ────────────────────────────────────────

  private async handleWebviewMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        if (msg.panelAgentId) {
          this.bridge.sendSync(msg.panelAgentId, msg.panelAgentId);
          break;
        }
        // If foreground isn't initialized yet (events not restored), defer
        if (!this.foregroundReady) {
          this.pendingSidebarSync = true;
          break;
        }
        this.replaySidebarSync();
        break;
      }

      case 'submit': {
        const agentId = msg.agentId ?? FOREGROUND_AGENT_ID;
        this.bridge.setMode(agentId, msg.mode);
        logger.info(`User input submitted (agent=${agentId}, mode=${msg.mode})`, {
          length: msg.text.length,
          attachments: msg.attachments?.length ?? 0,
        });

        // ── Parse @agent mentions ──
        const mentionRegex = /^(@[\w-]+\s*)+/;
        const match = msg.text.match(mentionRegex);

        if (agentId === FOREGROUND_AGENT_ID && match) {
          const mentionsStr = match[0];
          const task = msg.text.slice(mentionsStr.length).trim();
          const agentsToSpawn = mentionsStr.match(/@([\w-]+)/g)?.map(m => m.slice(1)) || [];

          if (agentsToSpawn.length > 0 && task) {
            // Echo user prompt in chat
            this.bridge.appendEvent(agentId, {
              id: `user-${Date.now()}`,
              role: 'user',
              content: msg.text,
              timestamp: now(),
              attachments: msg.attachments,
            });

            // Assistant confirms the dispatch
            this.bridge.appendEvent(agentId, {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: `Dispatching task to ${agentsToSpawn.length} agent${agentsToSpawn.length === 1 ? '' : 's'}:\n\n${agentsToSpawn.map(a => `- **${a}**`).join('\n')}`,
              timestamp: now()
            });

            // Spawn background agents concurrently
            const PROMPT_ROLES = ['orchestrator', 'planner', 'actor', 'summarizer'] as const;
            for (const label of agentsToSpawn) {
              const spawnOpts: any = { task, label };
              const lower = label.toLowerCase();
              if (lower === 'local') {
                const triage = this.settings.routing?.triage;
                if (triage) {
                  spawnOpts.model = {
                    provider: triage.providerId,
                    name: triage.model || ''
                  };
                }
              } else if ((PROMPT_ROLES as readonly string[]).includes(lower)) {
                spawnOpts.role = lower;
              }
              this.manager.spawn(spawnOpts);
            }
            break;
          }
        }

        // Record the user message in the slice so it shows immediately
        this.bridge.appendEvent(agentId, {
          id: `user-${Date.now()}`,
          role: 'user',
          content: msg.text,
          timestamp: now(),
          attachments: msg.attachments,
        });
        const host =
          agentId === FOREGROUND_AGENT_ID
            ? this.manager.getForeground()
            : this.manager.get(agentId)?.host;
        if (host) {
          const inputText = msg.mode === 'plan'
            ? wrapPlanMode(msg.text)
            : msg.text;
          
          if (host.isProcessing && agentId === FOREGROUND_AGENT_ID) {
            const isPlan = msg.mode === 'plan';
            this.bridge.appendEvent(agentId, {
              id: `sys-${Date.now()}`,
              role: 'system',
              content: isPlan
                ? 'Main agent is busy. Spawning a planner agent to handle this concurrently.'
                : 'Main agent is busy. Spawning a local background agent to handle this question concurrently.',
              timestamp: now(),
            });
            this.manager.spawn({
              task: inputText,
              label: isPlan ? 'Planner' : 'Secondary Query (Local)',
              role: isPlan ? 'planner' : undefined,
              model: isPlan ? undefined : (() => {
                const triage = this.settings.routing?.triage;
                return triage ? { provider: triage.providerId, name: triage.model || '' } : undefined;
              })()
            });
          } else {
            await host.submit(inputText, msg.attachments);
          }
        } else {
          logger.warn(`Submit ignored — agent "${agentId}" not available`);
          this.bridge.appendEvent(agentId, {
            id: `sys-${Date.now()}`,
            role: 'system',
            content: 'Agent is still initializing. Please wait a moment and try again.',
            timestamp: now(),
          });
        }
        break;
      }

      case 'interrupt': {
        const agentId = msg.agentId ?? FOREGROUND_AGENT_ID;
        getUserPromptBridge().cancelAll();
        const host =
          agentId === FOREGROUND_AGENT_ID
            ? this.manager.getForeground()
            : this.manager.get(agentId)?.host;
        await host?.interrupt();
        break;
      }

      case 'permission_response': {
        const agentId = msg.agentId ?? FOREGROUND_AGENT_ID;
        const host =
          agentId === FOREGROUND_AGENT_ID
            ? this.manager.getForeground()
            : this.manager.get(agentId)?.host;
        const policy = host?.getPermissionPolicy();
        if (msg.allowed && policy) {
          (policy as any).addToAllowList?.(msg.eventId);
          this.bridge.post({
            type: 'permission_resolved',
            agentId,
            eventId: msg.eventId,
            status: 'allowed',
          });
        } else {
          this.bridge.post({
            type: 'permission_resolved',
            agentId,
            eventId: msg.eventId,
            status: 'denied',
          });
        }
        break;
      }

      case 'ask_question_response': {
        const bridge = getUserPromptBridge();
        const handled = msg.cancelled
          ? bridge.resolveQuestion(msg.promptId, { cancelled: true })
          : bridge.resolveQuestion(msg.promptId, {
              cancelled: false,
              index: msg.answerIndex,
              text: msg.answerText,
            });
        if (!handled && this.peerAsks.has(msg.promptId)) {
          // Answer belongs to a peer-ask, not a local user/ask.
          const completedAt = Date.now();
          let updated;
          if (msg.cancelled) {
            updated = this.peerAsks.update(msg.promptId, {
              status: 'cancelled',
              reason: 'User dismissed the question.',
              completedAt,
            });
          } else {
            updated = this.peerAsks.update(msg.promptId, {
              status: 'answered',
              answerIndex: msg.answerIndex,
              answerText: msg.answerText,
              completedAt,
            });
          }
          // Push over SSE so the asking peer gets the answer instantly
          // without polling.
          if (updated) {
            this.peerManager.notifyAskResolved({
              rpcId: updated.rpcId,
              status: updated.status,
              answerIndex: updated.answerIndex,
              answerText: updated.answerText,
              reason: updated.reason,
            });
          }
        }
        break;
      }

      case 'ask_secret_response': {
        const bridge = getUserPromptBridge();
        if (msg.cancelled || typeof msg.value !== 'string') {
          bridge.resolveSecret(msg.promptId, { cancelled: true });
        } else {
          bridge.resolveSecret(msg.promptId, {
            cancelled: false,
            value: msg.value,
            saveToFile: msg.saveToFile,
          });
        }
        break;
      }

      case 'peer_dispatch_response': {
        void this.onPeerDispatchResponse(msg.promptId, msg.approved);
        break;
      }

      case 'request_provider_models': {
        const { getProviderModels } = await import('../config/model-listing');
        const providerList = await getProviderModels({});
        this.bridge.post({ type: 'provider_models', providers: providerList });
        break;
      }

      case 'change_model': {
        const newSettings: ObotovsSettings = {
          ...this.settings,
          routing: {
            ...this.settings.routing,
            executor: { providerId: msg.provider, model: msg.model },
          },
        };
        this.settings = newSettings;
        const changeTarget = msg.agentId ?? FOREGROUND_AGENT_ID;
        if (changeTarget === FOREGROUND_AGENT_ID) {
          await this.recreateAgent();
        } else {
          const rec = this.manager.get(changeTarget);
          if (rec?.host) await rec.host.recreate(newSettings);
        }
        break;
      }

      case 'new_chat':
        this.chatPanelOpener?.();
        break;

      case 'start_recording':
        if (this.speechToText) {
          void this.speechToText.startRecording();
        } else {
          this.bridge.post({ type: 'recording_error', error: 'Speech-to-text not available' });
        }
        break;

      case 'stop_recording':
        if (this.speechToText) {
          void this.speechToText.stopRecording();
        }
        break;

      case 'clear_session': {
        const clearId = msg.agentId ?? FOREGROUND_AGENT_ID;
        getUserPromptBridge().cancelAll();
        this.bridge.clearSlice(clearId);
        if (clearId === FOREGROUND_AGENT_ID) {
          await this.recreateAgent();
        } else {
          const rec = this.manager.get(clearId);
          if (rec?.host) await rec.host.recreate(this.settings);
        }
        break;
      }

      case 'revert': {
        const agentId = msg.agentId ?? FOREGROUND_AGENT_ID;
        const slice = this.bridge.getSlice(agentId);
        if (!slice) break;
        const idx = slice.events.findIndex((e: SessionEvent) => e.id === msg.eventId);
        if (idx !== -1) {
          slice.events = slice.events.slice(0, idx + 1);
        }
        break;
      }

      case 'delete_event': {
        const agentId = msg.agentId ?? FOREGROUND_AGENT_ID;
        const slice = this.bridge.getSlice(agentId);
        if (!slice) break;
        slice.events = slice.events.filter((e: SessionEvent) => e.id !== msg.eventId);
        break;
      }

      case 'edit_and_resubmit': {
        const agentId = msg.agentId ?? FOREGROUND_AGENT_ID;
        const slice = this.bridge.getSlice(agentId);
        if (!slice) break;
        // Revert to just before the edited message
        const idx = slice.events.findIndex((e: SessionEvent) => e.id === msg.eventId);
        if (idx !== -1) {
          slice.events = slice.events.slice(0, idx);
        }
        // Resubmit with edited text
        this.bridge.appendEvent(agentId, {
          id: `user-${Date.now()}`,
          role: 'user',
          content: msg.text,
          timestamp: now(),
        });
        const host =
          agentId === FOREGROUND_AGENT_ID
            ? this.manager.getForeground()
            : this.manager.get(agentId)?.host;
        if (host) {
          const mode = slice.mode;
          const inputText = mode === 'plan' ? wrapPlanMode(msg.text) : msg.text;
          await host.submit(inputText);
        }
        break;
      }

      case 'focus_agent':
        this.bridge.setFocus(msg.agentId);
        this.bridge.sendSync(msg.agentId);
        this.panelRevealer?.(msg.agentId);
        break;

      case 'cancel_agent':
        await this.manager.cancel(msg.agentId, 'Cancelled from UI');
        break;

      case 'request_objects_sync':
        this.broadcastObjects();
        break;

      case 'object_action':
        await this.handleObjectAction(msg.category, msg.action, msg.id, msg.agentId);
        break;
    }
  }

  // ── Object Manager ──────────────────────────────────────────────────

  private installObjectsWatcher(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;
    const pattern = new vscode.RelativePattern(folders[0], '.obotovs/**/*');
    try {
      this.objectsWatcher = vscode.workspace.createFileSystemWatcher(pattern);
      const trigger = () => this.scheduleObjectsBroadcast();
      this.objectsWatcher.onDidCreate(trigger);
      this.objectsWatcher.onDidChange(trigger);
      this.objectsWatcher.onDidDelete(trigger);
    } catch (err) {
      logger.warn('[objects] file watcher could not be installed', err);
    }
  }

  private scheduleObjectsBroadcast(): void {
    if (this.objectsBroadcastTimer) clearTimeout(this.objectsBroadcastTimer);
    this.objectsBroadcastTimer = setTimeout(() => this.broadcastObjects(), 250);
  }

  private broadcastObjects(): void {
    const snapshot = this.buildObjectSnapshot();
    this.bridge.post({ type: 'objects_sync', snapshot });
  }

  private buildObjectSnapshot(): ObjectSnapshot {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const surfaces: SurfaceInfo[] = this.surfaceManager.listSurfaces().map((name) => ({
      name,
      filePath: root ? path.join(root, '.obotovs', 'surfaces', `${name}.html`) : '',
    }));

    const routes: RouteInfo[] = this.routeManager.routes().map((r) => {
      const segments = r.urlPath.split('/').filter(Boolean);
      return { urlPath: r.urlPath, filePath: r.file, segments };
    });

    const skills: SkillInfo[] = this.skillManager.list().map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
    }));

    const memories: MemoryInfo[] = [];
    if (this.memoryManager) {
      for (const e of this.memoryManager.getGlobal().list(100)) {
        memories.push({
          id: e.id, title: e.title, scope: 'global',
          tags: e.tags, strength: e.strength, createdAt: e.createdAt,
        });
      }
      for (const e of this.memoryManager.getProject().list(100)) {
        memories.push({
          id: e.id, title: e.title, scope: 'project',
          tags: e.tags, strength: e.strength, createdAt: e.createdAt,
        });
      }
      for (const summary of this.bridge.listAgentSummaries()) {
        const field = this.memoryManager.getConversation(summary.id);
        for (const e of field.list(20)) {
          memories.push({
            id: e.id, title: e.title, scope: 'conversation',
            agentId: summary.id,
            tags: e.tags, strength: e.strength, createdAt: e.createdAt,
          });
        }
      }
      // Foreground agent has no summary entry — include its conversation separately.
      const fgField = this.memoryManager.getConversation(FOREGROUND_AGENT_ID);
      if (fgField.size() > 0) {
        for (const e of fgField.list(20)) {
          memories.push({
            id: e.id, title: e.title, scope: 'conversation',
            agentId: FOREGROUND_AGENT_ID,
            tags: e.tags, strength: e.strength, createdAt: e.createdAt,
          });
        }
      }
    }

    const conversations: ConversationInfo[] = [
      {
        id: this.sessionStore.getWindowId(),
        label: `Current window (${this.sessionStore.getWindowId().slice(0, 8)})`,
        kind: 'current',
        filePath: this.sessionStore.getCurrentSessionPath(),
      },
    ];
    // Archive list is async — populate from a cached copy when possible.
    // For V1, we fire a non-blocking refresh; the next broadcast carries them.
    this.refreshArchivesAsync();
    for (const name of this.archivesCache) {
      conversations.push({
        id: `archive:${name}`,
        label: name,
        kind: 'archive',
        filePath: path.join(this.sessionStore.getStorageDir(), 'history', `${name}.json`),
      });
    }

    return { surfaces, routes, skills, memories, conversations };
  }

  private archivesCache: string[] = [];
  private archivesRefreshInFlight = false;
  private async refreshArchivesAsync(): Promise<void> {
    if (this.archivesRefreshInFlight) return;
    this.archivesRefreshInFlight = true;
    try {
      const names = await this.sessionStore.listArchives();
      const changed = names.length !== this.archivesCache.length ||
        names.some((n, i) => this.archivesCache[i] !== n);
      this.archivesCache = names;
      if (changed) this.scheduleObjectsBroadcast();
    } catch (err) {
      logger.warn('[objects] failed to list archives', err);
    } finally {
      this.archivesRefreshInFlight = false;
    }
  }

  private async handleObjectAction(
    category: ObjectCategory,
    action: ObjectActionKind,
    id: string,
    agentId?: string,
  ): Promise<void> {
    try {
      switch (category) {
        case 'surface':
          return this.handleSurfaceAction(action, id);
        case 'route':
          return this.handleRouteAction(action, id);
        case 'skill':
          return this.handleSkillAction(action, id);
        case 'agent':
          return this.handleAgentAction(action, id);
        case 'memory':
          return this.handleMemoryAction(action, id, agentId);
        case 'conversation':
          return this.handleConversationAction(action, id);
      }
    } catch (err) {
      logger.warn(`[objects] ${category} ${action} failed for "${id}"`, err);
    }
  }

  private async handleSurfaceAction(action: ObjectActionKind, name: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const filePath = path.join(root, '.obotovs', 'surfaces', `${name}.html`);
    if (action === 'open') {
      const res = this.surfaceManager.openPanel(name, false);
      if (!res.ok && res.reason) vscode.window.showErrorMessage(res.reason);
    } else if (action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `Delete surface "${name}"?`, { modal: true }, 'Delete',
      );
      if (confirm === 'Delete') this.surfaceManager.delete(name);
    } else if (action === 'reveal') {
      await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(filePath));
    }
  }

  private handleSurfaceAutoFix(error: SurfaceError): void {
    const COOLDOWN_MS = 30_000;
    const lastAttempt = this.surfaceFixCooldowns.get(error.name) ?? 0;
    if (Date.now() - lastAttempt < COOLDOWN_MS) {
      logger.info(`[surfaces] Skipping auto-fix for "${error.name}" — cooldown active`);
      return;
    }
    this.surfaceFixCooldowns.set(error.name, Date.now());

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const filePath = path.join(root, '.obotovs', 'surfaces', `${error.name}.html`);

    let source: string;
    try {
      source = require('fs').readFileSync(filePath, 'utf8');
    } catch {
      logger.warn(`[surfaces] Cannot read source for auto-fix: ${filePath}`);
      return;
    }

    const errorDetail = [
      `Error: ${error.message}`,
      error.stack ? `Stack: ${error.stack}` : '',
      error.lineno ? `Line: ${error.lineno}, Col: ${error.colno ?? '?'}` : '',
    ].filter(Boolean).join('\n');

    const prompt =
      `The surface "${error.name}" threw a runtime JavaScript error in its webview panel.\n\n` +
      `${errorDetail}\n\n` +
      `Here is the full source of the surface:\n\n` +
      `\`\`\`html\n${source}\n\`\`\`\n\n` +
      `Fix the error by calling the surface/update tool with the corrected HTML. ` +
      `Only fix the bug — do not change the surface's behavior or appearance otherwise.`;

    const host = this.manager.getForeground();
    if (!host) return;

    logger.info(`[surfaces] Auto-fixing "${error.name}": ${error.message}`);

    this.bridge.appendEvent(FOREGROUND_AGENT_ID, {
      id: `system-surface-fix-${Date.now()}`,
      role: 'system',
      content: `Surface "${error.name}" crashed: ${error.message} — attempting auto-fix…`,
      timestamp: now(),
    });

    void host.submit(prompt);
  }

  private async handleRouteAction(action: ObjectActionKind, urlPath: string): Promise<void> {
    const route = this.routeManager.routes().find((r) => r.urlPath === urlPath);
    if (!route) return;
    const uri = vscode.Uri.file(route.file);
    if (action === 'open') {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    } else if (action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `Delete route "${urlPath}"?`, { modal: true }, 'Delete',
      );
      if (confirm === 'Delete') {
        await vscode.workspace.fs.delete(uri);
        this.routeManager.notifyChanged();
      }
    } else if (action === 'reveal') {
      await vscode.commands.executeCommand('revealInExplorer', uri);
    }
  }

  private async handleSkillAction(action: ObjectActionKind, name: string): Promise<void> {
    const skill = this.skillManager.get(name);
    if (!skill) return;
    const uri = vscode.Uri.file(skill.filePath);
    if (action === 'open') {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    } else if (action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `Delete skill "${name}"?`, { modal: true }, 'Delete',
      );
      if (confirm === 'Delete') await vscode.workspace.fs.delete(uri);
    } else if (action === 'reveal') {
      await vscode.commands.executeCommand('revealInExplorer', uri);
    }
  }

  private async handleAgentAction(action: ObjectActionKind, agentId: string): Promise<void> {
    if (action === 'open') {
      this.bridge.setFocus(agentId);
      this.bridge.sendSync(agentId);
    } else if (action === 'delete') {
      await this.manager.cancel(agentId, 'Cancelled from Object Manager');
    }
    // reveal: agents have no filesystem entry.
  }

  private async handleMemoryAction(
    action: ObjectActionKind,
    entryId: string,
    agentId?: string,
  ): Promise<void> {
    if (!this.memoryManager) return;
    if (action === 'delete') {
      this.memoryManager.remove(agentId ?? FOREGROUND_AGENT_ID, entryId);
      return;
    }
    // open / reveal — global + project have a JSON file; conversation is in-memory.
    let filePath: string | undefined;
    if (this.memoryManager.getGlobal().get(entryId)) {
      filePath = this.memoryManager.getGlobalPath();
    } else if (this.memoryManager.getProject().get(entryId)) {
      filePath = this.memoryManager.getProjectPath();
    }
    if (!filePath) return; // conversation-scope or not found
    const uri = vscode.Uri.file(filePath);
    if (action === 'open') {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    } else if (action === 'reveal') {
      await vscode.commands.executeCommand('revealInExplorer', uri);
    }
  }

  private async handleConversationAction(action: ObjectActionKind, id: string): Promise<void> {
    let filePath: string;
    if (id.startsWith('archive:')) {
      const name = id.slice('archive:'.length);
      filePath = path.join(this.sessionStore.getStorageDir(), 'history', `${name}.json`);
    } else {
      // current session
      filePath = this.sessionStore.getCurrentSessionPath();
    }
    const uri = vscode.Uri.file(filePath);
    if (action === 'open') {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
      } catch {
        vscode.window.showInformationMessage(`Session file not found: ${filePath}`);
      }
    } else if (action === 'delete') {
      if (!id.startsWith('archive:')) {
        vscode.window.showInformationMessage('Only archived sessions can be deleted from here.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete archive "${id.slice('archive:'.length)}"?`, { modal: true }, 'Delete',
      );
      if (confirm === 'Delete') {
        try { await vscode.workspace.fs.delete(uri); } catch { /* ignore */ }
        this.scheduleObjectsBroadcast();
      }
    } else if (action === 'reveal') {
      await vscode.commands.executeCommand('revealInExplorer', uri);
    }
  }

  // ── Slash commands ──────────────────────────────────────────────────

  private registerSlashCommands(): void {
    const host = this.manager.getForeground();
    const registry = host?.getSlashCommands();
    if (!registry) return;

    registry.registerCommand(
      { name: 'status', summary: 'Show agent status', argumentHint: '', resumeSupported: false },
      () => {
        const costSummary = host?.getCostSummary();
        const model = host?.getActiveModel();
        return [
          `Model: ${model?.model} (${model?.provider})`,
          `Permission mode: ${this.settings.permissionMode}`,
          `Triage: ${this.settings.triageEnabled ? 'enabled' : 'disabled'}`,
          `Session messages: ${host?.getSession()?.messages.length ?? 0}`,
          `Total cost: $${(costSummary as any)?.totalCost?.toFixed?.(4) ?? '0.0000'}`,
          `Background agents: ${this.manager.list('running').length} running, ${this.manager.list('complete').length} complete`,
        ].join('\n');
      },
    );

    registry.registerCommand(
      { name: 'cost', summary: 'Show cost breakdown', argumentHint: '', resumeSupported: false },
      () => {
        const summary = host?.getCostSummary();
        if (!summary) return 'Cost tracking not available.';
        return JSON.stringify(summary, null, 2);
      },
    );

    registry.registerCommand(
      { name: 'agents', summary: 'List background agents', argumentHint: '[running|complete|all]', resumeSupported: false },
      (args: string) => {
        const filter = args.trim().toLowerCase();
        const f: 'running' | 'complete' | 'all' =
          filter === 'running' || filter === 'complete' ? filter : 'all';
        const agents = this.manager.list(f);
        if (agents.length === 0) return `No ${f === 'all' ? '' : f + ' '}background agents.`;
        return agents
          .map(
            (a) =>
              `${a.id}  [${a.status}]  $${a.cost.totalCost.toFixed(4)}  ${a.label}`,
          )
          .join('\n');
      },
    );

    registry.registerCommand(
      { name: 'peers', summary: 'List other Oboto VS windows running on this workspace', argumentHint: '', resumeSupported: false },
      () => {
        const peers = this.peerManager.listPeers();
        if (peers.length === 0) {
          return `No peer windows.\nThis window: ${this.windowId.slice(0, 8)} (pid ${process.pid}).`;
        }
        const lines: string[] = [`${peers.length} peer window${peers.length === 1 ? '' : 's'}:`];
        for (const p of peers) {
          const age = Math.round((Date.now() - p.startedAt) / 1000);
          const running = p.agents.filter((a) => a.status === 'running').length;
          lines.push(
            `  ${p.windowId.slice(0, 8)}  pid=${p.pid}  port=${p.coordPort}  up=${age}s  agents=${p.agents.length} (${running} running)`,
          );
          for (const a of p.agents) {
            lines.push(`    └ ${a.id === 'foreground' ? 'foreground' : a.id.slice(0, 10)}  [${a.status}]  ${a.label}`);
          }
        }
        return lines.join('\n');
      },
    );
  }
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
