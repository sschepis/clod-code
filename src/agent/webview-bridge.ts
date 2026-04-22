/**
 * WebviewBridge — relays per-agent HostEvents to the webview, tagged with
 * agentId, and maintains the per-agent UI state slices that get replayed
 * to new webview mounts via `sync`.
 *
 * One bridge per extension instance. AgentHost subscribers plug into it
 * via `attach(host)`. The bridge owns:
 *   - Map<agentId, AgentUiSlice>  — event history, phase, cost, activeModel, streamingEventId
 *   - focusedAgentId              — which slice the webview is currently showing
 *   - Map<agentId, AgentSummary>  — summary row for the agents strip
 *
 * The bridge is intentionally UI-dumb — it doesn't know about spawn/cancel
 * semantics. AgentManager tells it when agents appear/disappear via
 * notifyAgentRegistered / notifyAgentDisposed / updateSummary.
 */

import type {
  ExtToWebviewMessage,
  SessionEvent,
  PhaseState,
  CostState,
  ModelInfo,
  AgentSummary,
  AgentStatus,
  RoutingMode,
} from '../shared/message-types';
import { FOREGROUND_AGENT_ID } from '../shared/message-types';
import type { AgentHost, HostEvent } from './agent-host';
import { logger } from '../shared/logger';

const MAX_EVENTS_PER_SLICE = 500;

export interface WebviewTarget {
  postMessage(msg: ExtToWebviewMessage): void;
  readonly isVisible: boolean;
}

interface AgentUiSlice {
  agentId: string;
  events: SessionEvent[];
  phase: PhaseState;
  cost: CostState;
  activeModel: ModelInfo;
  triageModel?: ModelInfo;
  routingMode: RoutingMode;
  streamingEventId: string | null;
  mode: 'act' | 'plan';
  planApprovalMode?: 'auto' | 'manual';
  consecutiveToolRounds: number;
}

export type SliceChangeListener = (agentId: string) => void;

export class WebviewBridge {
  private slices = new Map<string, AgentUiSlice>();
  private summaries = new Map<string, AgentSummary>();
  private hostDetachers = new Map<string, () => void>();
  private focusedAgentId: string = FOREGROUND_AGENT_ID;
  private targets = new Map<string, WebviewTarget>();
  private sliceChangeListeners: SliceChangeListener[] = [];

  constructor() {}

  onSliceChanged(listener: SliceChangeListener): void {
    this.sliceChangeListeners.push(listener);
  }

  private notifySliceChanged(agentId: string): void {
    for (const l of this.sliceChangeListeners) {
      try { l(agentId); } catch { /* best-effort */ }
    }
  }

  registerTarget(targetId: string, target: WebviewTarget): void {
    this.targets.set(targetId, target);
  }

  unregisterTarget(targetId: string): void {
    this.targets.delete(targetId);
  }

  // ── Slice lifecycle ──────────────────────────────────────────────────

  ensureSlice(agentId: string, initialModel: ModelInfo, mode: 'act' | 'plan' = 'act', triageModel?: ModelInfo, routingMode: RoutingMode = 'dual'): AgentUiSlice {
    let slice = this.slices.get(agentId);
    if (!slice) {
      slice = {
        agentId,
        events: [],
        phase: { phase: 'idle', message: '' },
        cost: { totalTokens: 0, totalCost: 0 },
        activeModel: initialModel,
        triageModel,
        routingMode,
        streamingEventId: null,
        mode,
        consecutiveToolRounds: 0,
      };
      this.slices.set(agentId, slice);
    }
    return slice;
  }

  deleteSlice(agentId: string): void {
    this.slices.delete(agentId);
    if (this.focusedAgentId === agentId) {
      this.focusedAgentId = FOREGROUND_AGENT_ID;
    }
  }

  getSlice(agentId: string): AgentUiSlice | undefined {
    return this.slices.get(agentId);
  }

  // ── Host attachment ──────────────────────────────────────────────────

  /**
   * Subscribe to a host's events and relay them into the slice for
   * `agentId`. Returns a detach function (also stored internally and
   * invoked by `detach(agentId)`).
   */
  attach(agentId: string, host: AgentHost): void {
    this.detach(agentId);

    // Pre-create slice so early events don't land in nothing
    this.ensureSlice(agentId, host.getActiveModel(), 'act', host.getTriageModel());

    const detach = host.on((event) => this.handleHostEvent(agentId, event));
    this.hostDetachers.set(agentId, detach);
  }

  detach(agentId: string): void {
    const detacher = this.hostDetachers.get(agentId);
    if (detacher) {
      detacher();
      this.hostDetachers.delete(agentId);
    }
  }

  // ── Agent summary bookkeeping ───────────────────────────────────────

  notifyAgentRegistered(summary: AgentSummary): void {
    this.summaries.set(summary.id, summary);
    this.post({ type: 'agent_spawned', agent: summary });
  }

  updateSummary(agentId: string, patch: Partial<AgentSummary>): void {
    const current = this.summaries.get(agentId);
    if (!current) return;
    const next: AgentSummary = { ...current, ...patch };
    this.summaries.set(agentId, next);
    this.post({
      type: 'agent_status',
      agentId,
      status: next.status,
      cost: next.cost,
      result: next.result,
      error: next.error,
      completedAt: next.completedAt,
    });
  }

  notifyAgentDisposed(agentId: string): void {
    this.summaries.delete(agentId);
    this.deleteSlice(agentId);
    this.detach(agentId);
    this.post({ type: 'agent_disposed', agentId });
  }

  listAgentSummaries(): AgentSummary[] {
    return [...this.summaries.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  getSummary(agentId: string): AgentSummary | undefined {
    return this.summaries.get(agentId);
  }

  // ── Focus tracking ───────────────────────────────────────────────────

  setFocus(agentId: string): void {
    this.focusedAgentId = agentId;
  }

  getFocus(): string {
    return this.focusedAgentId;
  }

  // ── Webview API ──────────────────────────────────────────────────────

  /**
   * Send a full sync for a single slice. Used when the webview first
   * connects or when focus switches to an agent the webview hasn't
   * seen yet.
   */
  sendSync(agentId: string, focusOverride?: string): void {
    const slice = this.slices.get(agentId);
    if (!slice) return;

    // Truncate event history if it's grown past the cap
    const events =
      slice.events.length > MAX_EVENTS_PER_SLICE
        ? slice.events.slice(-MAX_EVENTS_PER_SLICE)
        : slice.events;

    const msg: ExtToWebviewMessage = {
      type: 'sync',
      agentId,
      events,
      phase: slice.phase,
      cost: slice.cost,
      activeModel: slice.activeModel,
      triageModel: slice.triageModel,
      routingMode: slice.routingMode,
      mode: slice.mode,
      agents: this.listAgentSummaries(),
      focusedAgentId: focusOverride ?? this.focusedAgentId,
    };

    // If this sync targets a dedicated panel, send directly to it
    // instead of broadcasting — prevents the sidebar from switching
    // its focus to the new panel's conversation.
    const panelTarget = this.targets.get(agentId);
    if (panelTarget && focusOverride) {
      panelTarget.postMessage(msg);
      return;
    }

    this.post(msg);
  }

  sendAgentsSync(): void {
    this.post({
      type: 'agents_sync',
      agents: this.listAgentSummaries(),
      focusedAgentId: this.focusedAgentId,
    });
  }

  /** Post arbitrary ext→webview message; routes to the correct target(s). */
  post(msg: ExtToWebviewMessage): void {
    const agentId = (msg as any).agentId as string | undefined;
    const sidebar = this.targets.get('sidebar');

    if (!agentId) {
      // Global messages: broadcast to all targets
      for (const target of this.targets.values()) {
        target.postMessage(msg);
      }
      return;
    }

    // Check if a dedicated panel target exists for this agentId
    const panelTarget = this.targets.get(agentId);
    if (panelTarget) {
      panelTarget.postMessage(msg);
    }

    // Sidebar always gets everything (it's the control center)
    if (sidebar && sidebar !== panelTarget) {
      sidebar.postMessage(msg);
    }
  }

  /**
   * Append an event to a slice's history and broadcast it. Used by
   * the prompt bridge (ask/secret) and other non-host sources.
   */
  appendEvent(agentId: string, event: SessionEvent): void {
    const slice = this.slices.get(agentId);
    if (!slice) {
      // Only allow appends when a slice exists (the agent must be
      // registered); silently drop otherwise to avoid orphan state.
      return;
    }
    slice.events.push(event);
    if (slice.events.length > MAX_EVENTS_PER_SLICE) {
      slice.events.splice(0, slice.events.length - MAX_EVENTS_PER_SLICE);
    }
    this.post({ type: 'event', agentId, event });
    this.notifySliceChanged(agentId);
  }

  /**
   * In-place patch of an existing event, without broadcasting an add.
   * Used by the ask/secret bridges to update status.
   */
  patchEvent(agentId: string, predicate: (e: SessionEvent) => boolean, patch: Partial<SessionEvent>): void {
    const slice = this.slices.get(agentId);
    if (!slice) return;
    const idx = slice.events.findIndex(predicate);
    if (idx === -1) return;
    slice.events[idx] = { ...slice.events[idx], ...patch } as SessionEvent;
    this.notifySliceChanged(agentId);
  }

  clearSlice(agentId: string): void {
    const slice = this.slices.get(agentId);
    if (!slice) return;
    slice.events = [];
    slice.phase = { phase: 'idle', message: '' };
    slice.cost = { totalTokens: 0, totalCost: 0 };
    slice.streamingEventId = null;
    this.post({ type: 'clear', agentId });
  }

  clearStaleErrors(agentId: string): void {
    const slice = this.slices.get(agentId);
    if (!slice) return;
    slice.events = slice.events.filter((e) => {
      if (e.role !== 'system') return true;
      const text = (e as { content?: string }).content ?? '';
      return !(
        text.includes('Failed to initialize agent') ||
        text.includes('API key required')
      );
    });
    this.post({ type: 'clear_stale_errors', agentId });
  }

  setRoutingMode(agentId: string, mode: RoutingMode): void {
    const slice = this.slices.get(agentId);
    if (!slice) return;
    slice.routingMode = mode;
  }

  /** Update mode (act/plan) for a given slice. */
  setMode(agentId: string, mode: 'act' | 'plan'): void {
    const slice = this.slices.get(agentId);
    if (!slice) return;
    slice.mode = mode;
  }

  setPlanApprovalMode(agentId: string, mode: 'auto' | 'manual'): void {
    const slice = this.slices.get(agentId);
    if (!slice) return;
    slice.planApprovalMode = mode;
  }

  getPlanApprovalMode(agentId: string): 'auto' | 'manual' | undefined {
    return this.slices.get(agentId)?.planApprovalMode;
  }

  /** Returns slice.cost aggregated across all agents. */
  aggregateCost(): CostState {
    let totalTokens = 0;
    let totalCost = 0;
    for (const slice of this.slices.values()) {
      totalTokens += slice.cost.totalTokens;
      totalCost += slice.cost.totalCost;
    }
    return { totalTokens, totalCost };
  }

  // ── HostEvent → webview translation ─────────────────────────────────

  private handleHostEvent(agentId: string, event: HostEvent): void {
    const slice = this.slices.get(agentId);
    if (!slice) {
      logger.warn(`WebviewBridge: event for unknown agent "${agentId}"`, event.type);
      return;
    }

    switch (event.type) {
      case 'phase':
        slice.phase = { phase: event.phase as any, message: event.message };
        this.post({ type: 'phase', agentId, phase: slice.phase.phase, message: event.message });
        break;

      case 'triage':
        this.appendEvent(agentId, {
          id: `thought-${Date.now()}-${rand()}`,
          role: 'thought',
          content: event.reasoning,
          timestamp: now(),
        });
        break;

      case 'thought': {
        if (!event.text) return;
        slice.consecutiveToolRounds = 0;
        if (slice.streamingEventId) {
          slice.streamingEventId = null;
          return;
        }
        this.appendEvent(agentId, {
          id: `assistant-${Date.now()}-${rand()}`,
          role: 'assistant',
          content: event.text,
          model: event.model ?? slice.activeModel.model,
          timestamp: now(),
        });
        break;
      }

      case 'token': {
        slice.consecutiveToolRounds = 0;
        if (!slice.streamingEventId) {
          slice.streamingEventId = `assistant-${Date.now()}-${rand()}`;
        }
        const eventId = slice.streamingEventId;
        const lastIdx = slice.events.length - 1;
        const last = lastIdx >= 0 ? slice.events[lastIdx] : undefined;
        if (last && last.id === eventId && last.role === 'assistant') {
          slice.events[lastIdx] = { ...last, content: last.content + event.text } as SessionEvent;
        } else {
          slice.events.push({
            id: eventId,
            role: 'assistant',
            content: event.text,
            model: slice.activeModel.model,
            timestamp: now(),
          });
          if (slice.events.length > MAX_EVENTS_PER_SLICE) {
            slice.events.splice(0, slice.events.length - MAX_EVENTS_PER_SLICE);
          }
        }
        this.post({ type: 'token', agentId, text: event.text, eventId });
        this.notifySliceChanged(agentId);
        break;
      }

      case 'tool_start': {
        slice.streamingEventId = null;
        const eventId = `tool-${Date.now()}-${rand()}`;
        this.appendEvent(agentId, {
          id: eventId,
          role: 'tool',
          toolName: event.command,
          command: event.command,
          status: 'running',
          kwargs: event.kwargs,
          timestamp: now(),
        });
        break;
      }

      case 'tool_complete': {
        for (let i = slice.events.length - 1; i >= 0; i--) {
          const e = slice.events[i];
          if (e.role === 'tool' && e.status === 'running' && e.command === event.command) {
            const status = event.error ? 'error' : 'success';
            const output = event.result || event.error || '';
            const duration = event.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : undefined;
            slice.events[i] = { ...e, status, output, duration } as SessionEvent;
            this.post({
              type: 'tool_status',
              agentId,
              eventId: e.id,
              status,
              output,
              duration,
            });
            this.notifySliceChanged(agentId);
            break;
          }
        }
        break;
      }

      case 'tool_round': {
        slice.consecutiveToolRounds++;
        const NARRATIVE_THRESHOLD = 3;
        if (slice.consecutiveToolRounds >= NARRATIVE_THRESHOLD) {
          const summary = this.buildProgressSummary(slice);
          if (summary) {
            this.appendEvent(agentId, {
              id: `narrative-${Date.now()}-${rand()}`,
              role: 'narrative',
              content: summary,
              iteration: event.iteration,
              totalToolCalls: event.totalToolCalls,
              timestamp: now(),
            });
          }
        }
        break;
      }

      case 'commentary': {
        slice.consecutiveToolRounds = 0;
        this.appendEvent(agentId, {
          id: `narrative-${Date.now()}-${rand()}`,
          role: 'narrative',
          content: event.text,
          iteration: 0,
          totalToolCalls: 0,
          timestamp: now(),
        });
        break;
      }

      case 'turn_complete':
        slice.phase = { phase: 'idle', message: '' };
        slice.consecutiveToolRounds = 0;
        this.post({ type: 'phase', agentId, phase: 'idle', message: '' });
        break;

      case 'cost':
        slice.cost = { totalTokens: event.totalTokens, totalCost: event.totalCost };
        this.post({ type: 'cost_update', agentId, cost: slice.cost });
        break;

      case 'permission_denied': {
        const eventId = `perm-${Date.now()}-${rand()}`;
        this.post({
          type: 'permission_request',
          agentId,
          eventId,
          toolName: event.toolName,
          toolInput: event.toolInput,
          description: event.reason,
        });
        break;
      }

      case 'error':
        this.appendEvent(agentId, {
          id: `sys-${Date.now()}-${rand()}`,
          role: 'system',
          content: `Error: ${event.message}`,
          timestamp: now(),
        });
        break;

      case 'doom_loop':
        this.appendEvent(agentId, {
          id: `sys-${Date.now()}-${rand()}`,
          role: 'system',
          content: `Doom loop detected: ${event.reason}`,
          timestamp: now(),
        });
        break;

      case 'initialized':
        slice.activeModel = event.model;
        slice.triageModel = event.triageModel;
        this.clearStaleErrors(agentId);
        this.post({ type: 'model_changed', agentId, model: event.model, triageModel: event.triageModel, routingMode: slice.routingMode });
        break;

      case 'disposed':
        // Host tells us it's gone; summaries/detach handled by notifyAgentDisposed
        break;
    }
  }

  private buildProgressSummary(slice: AgentUiSlice): string | null {
    const events = slice.events;
    const recentCalls: string[] = [];
    for (let i = events.length - 1; i >= 0 && recentCalls.length < 8; i--) {
      const e = events[i];
      if (e.role === 'narrative' || e.role === 'assistant') break;
      if (e.role === 'tool' && e.command) {
        const cmd = e.command.split('/').pop() ?? e.command;
        const target = this.extractTarget(e.kwargs);
        recentCalls.unshift(target ? `${cmd} ${target}` : cmd);
      }
    }
    if (recentCalls.length === 0) return null;
    return recentCalls.join(' → ');
  }

  private extractTarget(kwargs?: Record<string, unknown>): string {
    if (!kwargs) return '';
    const path = (kwargs.path ?? kwargs.file ?? kwargs.filePath ?? kwargs.file_path ?? '') as string;
    if (path) {
      const parts = path.split('/');
      return parts.length > 2 ? parts.slice(-2).join('/') : parts[parts.length - 1];
    }
    const pattern = (kwargs.pattern ?? kwargs.query ?? kwargs.cmd ?? '') as string;
    if (pattern) {
      const short = String(pattern).slice(0, 40);
      return short.length < String(pattern).length ? `"${short}…"` : `"${short}"`;
    }
    return '';
  }
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function rand(): string {
  return Math.random().toString(36).slice(2, 6);
}
