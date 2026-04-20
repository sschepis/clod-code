/**
 * AgentManager — central registry for all AgentHost instances.
 *
 * Owns:
 *   - The foreground agent (special-cased id "foreground")
 *   - Any spawned background agents
 *   - Lineage tracking (for recursion guards in future phases)
 *   - Concurrency + timeout enforcement
 *
 * Does not own the webview. WebviewBridge attaches to each host for UI
 * relay; AgentManager also notifies the bridge when summaries change.
 */

import type { Router, SessionManager } from '@sschepis/swiss-army-tool';
import type { AgentRuntime } from '@sschepis/as-agent';

import type { ObotovsSettings, PromptRole } from '../config/settings';
import type {
  AgentStatus,
  AgentSummary,
  CostState,
} from '../shared/message-types';
import { FOREGROUND_AGENT_ID } from '../shared/message-types';
import { AgentHost, type HostEvent } from './agent-host';
import type { WebviewBridge } from './webview-bridge';
import type { PermissionModeLabel } from './permission-prompter';
import { buildToolTree, type ToolTreeDeps } from './tool-tree';
import { logger } from '../shared/logger';
import { getErrorMessage } from '../shared/errors';
import type { SkillManager } from '../skills/skill-manager';

export interface SpawnOpts {
  task: string;
  systemPrompt?: string;
  model?: { provider?: string; name?: string };
  budgetUsd?: number;
  timeoutMs?: number;
  permissionMode?: PermissionModeLabel;
  parentId?: string;
  /** Short human label for the summary strip. Derived from task if omitted. */
  label?: string;
  /** Shared batch ID for agents spawned together via agent/batch. */
  batchId?: string;
  /** Routing role — selects provider/model from the routing config. */
  role?: PromptRole;
}

export interface SpawnResult {
  ok: true;
  agentId: string;
  host: AgentHost;
}

export interface SpawnFailure {
  ok: false;
  error: string;
}

export interface AgentManagerConfig {
  settings: ObotovsSettings;
  agentRuntime?: AgentRuntime;
  /**
   * Factory producing a fresh tool tree for each host. Each host has its
   * own Router/session because swiss-army-tool Router mutates CWD/history
   * per command — sharing would cross-contaminate.
   */
  toolTreeFactory: (agentId: string) => { router: Router; session: SessionManager };
  bridge: WebviewBridge;
  /** Optional — surfaced in spawned-agent system prompts so they know available skills. */
  skills?: SkillManager;
  /** Optional — invoked whenever agent summaries change (spawn, status, cost, etc.). */
  onSummariesChanged?: () => void;
  /**
   * Optional — invoked right after a spawned agent is attached to the
   * bridge and timers are set, but before the task is submitted. Used to
   * wire up memory-manager snapshot and auto-capture.
   */
  onAgentSpawned?: (agentId: string, host: AgentHost, parentId?: string) => void;
}

interface InstanceRecord {
  id: string;
  host: AgentHost;
  summary: AgentSummary;
  lineage: Set<string>;    // ancestor ids, NOT including self
  createdAt: number;
  parentId?: string;
  timeoutHandle?: NodeJS.Timeout;
  detach?: () => void;
  completionWaiters: Array<(r: CompletionResult) => void>;
  completed: boolean;
  completionResult?: CompletionResult;
  interactive?: boolean;
  budgetUsd: number;
  spentByChildren: number;
  batchId?: string;
}

export interface CompletionResult {
  status: 'complete' | 'error' | 'cancelled';
  result?: string;
  error?: string;
}

export class AgentManager {
  private instances = new Map<string, InstanceRecord>();
  private settings: ObotovsSettings;
  private agentRuntime?: AgentRuntime;
  private toolTreeFactory: AgentManagerConfig['toolTreeFactory'];
  private bridge: WebviewBridge;
  private skills?: SkillManager;
  private onSummariesChanged?: () => void;
  private onAgentSpawned?: AgentManagerConfig['onAgentSpawned'];
  private counter = 0;

  constructor(config: AgentManagerConfig) {
    this.settings = config.settings;
    this.agentRuntime = config.agentRuntime;
    this.toolTreeFactory = config.toolTreeFactory;
    this.bridge = config.bridge;
    this.skills = config.skills;
    this.onSummariesChanged = config.onSummariesChanged;
    this.onAgentSpawned = config.onAgentSpawned;
  }

  private notifySummariesChanged(): void {
    try { this.onSummariesChanged?.(); } catch { /* best-effort */ }
  }

  updateSettings(newSettings: ObotovsSettings): void {
    this.settings = newSettings;
  }

  setAgentRuntime(rt: AgentRuntime | undefined): void {
    this.agentRuntime = rt;
  }

  // ── Foreground ──────────────────────────────────────────────────────

  /**
   * Register the foreground host. Called once by Orchestrator during
   * initialization. Foreground is tracked in the instances map for
   * uniform lookup but is never cancelled/disposed via the normal
   * cancel path.
   */
  registerForeground(host: AgentHost): void {
    const summary: AgentSummary = {
      id: FOREGROUND_AGENT_ID,
      label: 'Foreground',
      status: 'idle',
      model: host.getActiveModel(),
      cost: { totalTokens: 0, totalCost: 0 },
      createdAt: Date.now(),
      depth: 0,
    };
    const record: InstanceRecord = {
      id: FOREGROUND_AGENT_ID,
      host,
      summary,
      lineage: new Set(),
      createdAt: Date.now(),
      completionWaiters: [],
      completed: false,
      budgetUsd: Infinity,
      spentByChildren: 0,
    };
    record.detach = host.on((e) => this.handleForegroundEvent(e));
    this.instances.set(FOREGROUND_AGENT_ID, record);
    this.bridge.notifyAgentRegistered(summary);
    this.bridge.attach(FOREGROUND_AGENT_ID, host);
    this.notifySummariesChanged();
  }

  getForeground(): AgentHost | undefined {
    return this.instances.get(FOREGROUND_AGENT_ID)?.host;
  }

  // ── Interactive (chat panel) agents ─────────────────────────────────

  registerInteractive(panelId: string, host: AgentHost): void {
    const summary: AgentSummary = {
      id: panelId,
      label: panelId,
      status: 'idle',
      model: host.getActiveModel(),
      cost: { totalTokens: 0, totalCost: 0 },
      createdAt: Date.now(),
      depth: 0,
    };
    const record: InstanceRecord = {
      id: panelId,
      host,
      summary,
      lineage: new Set(),
      createdAt: Date.now(),
      completionWaiters: [],
      completed: false,
      interactive: true,
      budgetUsd: Infinity,
      spentByChildren: 0,
    };
    record.detach = host.on((e) => this.handleInteractiveEvent(panelId, e));
    this.instances.set(panelId, record);
    this.bridge.notifyAgentRegistered(summary);
    this.bridge.attach(panelId, host);
    this.notifySummariesChanged();
  }

  disposeInteractive(panelId: string): void {
    this.teardownInstance(panelId);
  }

  isInteractive(agentId: string): boolean {
    return this.instances.get(agentId)?.interactive === true;
  }

  getDepth(agentId: string): number {
    return this.instances.get(agentId)?.lineage.size ?? 0;
  }

  canSpawnChildren(agentId: string): boolean {
    if (agentId === FOREGROUND_AGENT_ID) return true;
    if (this.isInteractive(agentId)) return true;
    const depth = this.getDepth(agentId);
    const maxDepth = this.settings.maxAgentNestingDepth ?? 2;
    return depth < maxDepth;
  }

  async recreateForeground(newSettings: ObotovsSettings): Promise<void> {
    this.updateSettings(newSettings);
    const record = this.instances.get(FOREGROUND_AGENT_ID);
    if (!record) return;
    await record.host.recreate(newSettings);
    record.summary.model = record.host.getActiveModel();
    this.bridge.updateSummary(FOREGROUND_AGENT_ID, { model: record.summary.model });
  }

  // ── Spawn ───────────────────────────────────────────────────────────

  async spawn(opts: SpawnOpts): Promise<SpawnResult | SpawnFailure> {
    // ── Concurrent limit (excludes foreground) ────────────────────────
    const runningBackground = [...this.instances.values()].filter(
      (r) => r.id !== FOREGROUND_AGENT_ID && r.summary.status === 'running',
    ).length;
    const limit = this.settings.maxConcurrentAgents ?? 5;
    if (runningBackground >= limit) {
      return {
        ok: false,
        error:
          `Cannot spawn: ${runningBackground} background agents already running ` +
          `(limit: ${limit}). Use agent/list to see them, agent/cancel to free slots, ` +
          `or raise "obotovs.maxConcurrentAgents" in settings.`,
      };
    }

    // ── Compute lineage ───────────────────────────────────────────────
    const parentId = opts.parentId;
    let lineage: Set<string>;
    if (parentId) {
      const parent = this.instances.get(parentId);
      if (!parent) {
        return { ok: false, error: `Parent agent "${parentId}" not found.` };
      }
      lineage = new Set(parent.lineage);
      lineage.add(parentId);
    } else {
      lineage = new Set();
    }

    // Depth-limited recursive spawning
    const maxDepth = this.settings.maxAgentNestingDepth ?? 2;
    if (lineage.size > maxDepth) {
      return {
        ok: false,
        error:
          `Maximum agent nesting depth (${maxDepth}) exceeded. ` +
          `This agent is at depth ${lineage.size}. Raise "obotovs.maxAgentNestingDepth" to allow deeper nesting.`,
      };
    }

    // ── Validate budget/timeout (cascade from parent) ────────────────
    let budgetUsd = opts.budgetUsd ?? this.settings.defaultAgentBudgetUsd ?? 0.5;
    let timeoutMs = opts.timeoutMs ?? this.settings.agentTimeoutMs ?? 300_000;

    if (parentId) {
      const parent = this.instances.get(parentId);
      if (parent && !parent.interactive && parent.id !== FOREGROUND_AGENT_ID) {
        const parentRemaining = parent.budgetUsd - parent.summary.cost.totalCost - parent.spentByChildren;
        if (parentRemaining <= 0) {
          return { ok: false, error: `Parent agent "${parentId}" has no remaining budget for child agents.` };
        }
        budgetUsd = Math.min(budgetUsd, parentRemaining);

        const parentElapsed = Date.now() - parent.createdAt;
        const parentTimeoutMs = parent.timeoutHandle ? (this.settings.agentTimeoutMs ?? 300_000) : Infinity;
        const parentTimeRemaining = parentTimeoutMs - parentElapsed;
        if (parentTimeRemaining <= 0) {
          return { ok: false, error: `Parent agent "${parentId}" has no remaining time for child agents.` };
        }
        timeoutMs = Math.min(timeoutMs, Math.max(parentTimeRemaining, 5000));
      }
    }
    if (!opts.task || !opts.task.trim()) {
      return { ok: false, error: 'Task is required and cannot be empty.' };
    }

    // ── Build the instance settings (may override model) ─────────────
    const instanceSettings: ObotovsSettings = { ...this.settings };
    if (opts.model?.provider || opts.model?.name) {
      const currentExec = instanceSettings.routing?.executor;
      instanceSettings.routing = {
        ...instanceSettings.routing,
        executor: {
          providerId: opts.model?.provider ?? currentExec?.providerId ?? 'oboto',
          model: opts.model?.name ?? currentExec?.model,
        },
      };
    }

    // ── Construct host ────────────────────────────────────────────────
    this.counter += 1;
    const agentId = `agent-${Date.now().toString(36)}-${this.counter}`;
    const { router } = this.toolTreeFactory(agentId);
    const host = new AgentHost({
      id: agentId,
      settings: instanceSettings,
      router,
      agentRuntime: this.agentRuntime,
      systemPromptOverride: opts.systemPrompt,
      permissionModeOverride: opts.permissionMode,
      skills: this.skills,
      role: opts.role,
    });

    const summary: AgentSummary = {
      id: agentId,
      parentId,
      label: opts.label ?? truncateLabel(opts.task),
      task: opts.task,
      status: 'running',
      model: host.getActiveModel(),
      cost: { totalTokens: 0, totalCost: 0 },
      createdAt: Date.now(),
      depth: lineage.size,
      batchId: opts.batchId,
    };

    const record: InstanceRecord = {
      id: agentId,
      host,
      summary,
      lineage,
      createdAt: Date.now(),
      parentId,
      completionWaiters: [],
      completed: false,
      budgetUsd,
      spentByChildren: 0,
      batchId: opts.batchId,
    };
    this.instances.set(agentId, record);
    this.bridge.notifyAgentRegistered(summary);
    this.bridge.attach(agentId, host);
    this.notifySummariesChanged();

    // Timeout timer
    record.timeoutHandle = setTimeout(() => {
      logger.warn(`Agent "${agentId}" timed out after ${timeoutMs}ms`);
      this.completeInstance(agentId, {
        status: 'error',
        error: `Timed out after ${(timeoutMs / 1000).toFixed(0)}s`,
      });
    }, timeoutMs);

    // Attach event listener for completion tracking
    record.detach = host.on((e) => this.handleSpawnedEvent(agentId, e));

    // Allow the orchestrator to wire up memory snapshot + auto-capture
    try { this.onAgentSpawned?.(agentId, host, parentId); } catch (err) {
      logger.warn(`onAgentSpawned hook threw for "${agentId}"`, err);
    }

    // Initialize and submit task
    try {
      await host.initialize();
      // Submit the task asynchronously — we don't await here, completion is
      // signalled by turn_complete or error events.
      host.submit(opts.task).catch((err) => {
        logger.error(`Agent "${agentId}" submit failed`, err);
        this.completeInstance(agentId, {
          status: 'error',
          error: getErrorMessage(err),
        });
      });

      logger.info(`Agent "${agentId}" spawned`, {
        task: opts.task.slice(0, 100),
        model: `${instanceSettings.routing?.executor?.providerId ?? 'oboto'}/${instanceSettings.routing?.executor?.model ?? ''}`,
        budgetUsd,
        timeoutMs,
      });

      return { ok: true, agentId, host };
    } catch (err) {
      const msg = getErrorMessage(err);
      logger.error(`Agent "${agentId}" failed to spawn`, err);
      this.completeInstance(agentId, { status: 'error', error: msg });
      return { ok: false, error: msg };
    }
  }

  // ── Query / list ────────────────────────────────────────────────────

  getBridge() { return this.bridge; }


  reloadToolTree(agentId: string): boolean {
    const id = agentId === 'foreground' ? 'foreground' : agentId;
    const record = this.instances.get(id);
    if (!record) return false;
    try {
      const { router } = this.toolTreeFactory(id);
      record.host.setRouter(router);
      return true;
    } catch (err) {
      console.error('Failed to reload tool tree:', err);
      return false;
    }
  }

  get(agentId: string): InstanceRecord | undefined {
    return this.instances.get(agentId);
  }

  list(filter?: 'running' | 'complete' | 'all'): AgentSummary[] {
    const all = [...this.instances.values()].filter((r) => r.id !== FOREGROUND_AGENT_ID && !r.interactive);
    const filtered =
      filter === 'running'
        ? all.filter((r) => r.summary.status === 'running')
        : filter === 'complete'
        ? all.filter((r) => r.summary.status !== 'running')
        : all;
    return filtered.map((r) => ({ ...r.summary })).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Every agent this window knows about, including the foreground. */
  listAll(): AgentSummary[] {
    return [...this.instances.values()]
      .map((r) => ({ ...r.summary }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Await an instance's completion. If already completed, resolves
   * immediately with the stored result.
   */
  waitForCompletion(agentId: string): Promise<CompletionResult> {
    const record = this.instances.get(agentId);
    if (!record) {
      return Promise.resolve({ status: 'error', error: `Agent "${agentId}" not found` });
    }
    if (record.completed && record.completionResult) {
      return Promise.resolve(record.completionResult);
    }
    return new Promise((resolve) => {
      record.completionWaiters.push(resolve);
    });
  }

  // ── Cancel / dispose ────────────────────────────────────────────────

  async cancel(agentId: string, reason = 'Cancelled by user'): Promise<boolean> {
    if (agentId === FOREGROUND_AGENT_ID) {
      const fg = this.getForeground();
      await fg?.interrupt();
      return true;
    }
    // Interactive agents behave like foreground: interrupt, don't teardown
    if (this.instances.get(agentId)?.interactive) {
      await this.instances.get(agentId)!.host.interrupt();
      return true;
    }
    const record = this.instances.get(agentId);
    if (!record) return false;
    if (record.completed) return false;

    try {
      await record.host.interrupt();
    } catch (err) {
      logger.warn(`Agent "${agentId}" interrupt failed`, err);
    }
    this.completeInstance(agentId, { status: 'cancelled', error: reason });
    return true;
  }

  /** Dispose a single instance or all (if id omitted). */
  async dispose(agentId?: string): Promise<void> {
    if (agentId) {
      const record = this.instances.get(agentId);
      if (!record) return;
      this.teardownInstance(agentId);
      return;
    }
    for (const id of [...this.instances.keys()]) {
      this.teardownInstance(id);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────

  private handleForegroundEvent(event: HostEvent): void {
    const rec = this.instances.get(FOREGROUND_AGENT_ID);
    if (!rec) return;
    // Foreground never "completes" in the spawn sense; we only mirror cost
    if (event.type === 'cost') {
      rec.summary.cost = { totalTokens: event.totalTokens, totalCost: event.totalCost };
      this.bridge.updateSummary(FOREGROUND_AGENT_ID, { cost: rec.summary.cost });
    } else if (event.type === 'phase') {
      rec.summary.status = event.phase === 'idle' ? 'idle' : 'running';
      this.bridge.updateSummary(FOREGROUND_AGENT_ID, { status: rec.summary.status });
      this.notifySummariesChanged();
    } else if (event.type === 'initialized') {
      rec.summary.model = event.model;
      this.bridge.updateSummary(FOREGROUND_AGENT_ID, { model: event.model });
    }
  }

  private handleInteractiveEvent(panelId: string, event: HostEvent): void {
    const rec = this.instances.get(panelId);
    if (!rec) return;
    if (event.type === 'cost') {
      rec.summary.cost = { totalTokens: event.totalTokens, totalCost: event.totalCost };
      this.bridge.updateSummary(panelId, { cost: rec.summary.cost });
    } else if (event.type === 'phase') {
      rec.summary.status = event.phase === 'idle' ? 'idle' : 'running';
      this.bridge.updateSummary(panelId, { status: rec.summary.status });
      this.notifySummariesChanged();
    } else if (event.type === 'initialized') {
      rec.summary.model = event.model;
      this.bridge.updateSummary(panelId, { model: event.model });
    }
  }

  private handleSpawnedEvent(agentId: string, event: HostEvent): void {
    const rec = this.instances.get(agentId);
    if (!rec || rec.completed) return;

    switch (event.type) {
      case 'cost':
        rec.summary.cost = { totalTokens: event.totalTokens, totalCost: event.totalCost };
        this.bridge.updateSummary(agentId, { cost: rec.summary.cost });
        this.enforceBudget(rec);
        break;

      case 'turn_complete': {
        // Background agents run one turn (the task) then complete. Harvest
        // the last assistant message from the slice as the "result".
        const slice = this.bridge.getSlice(agentId);
        const assistantMsg = slice?.events
          .slice()
          .reverse()
          .find((e) => e.role === 'assistant');
        const result = assistantMsg && assistantMsg.role === 'assistant'
          ? assistantMsg.content
          : 'Agent completed without a final message.';
        this.completeInstance(agentId, { status: 'complete', result });
        break;
      }

      case 'error':
        this.completeInstance(agentId, { status: 'error', error: event.message });
        break;
    }
  }

  private enforceBudget(rec: InstanceRecord): void {
    const budget = rec.budgetUsd;
    const totalSpent = rec.summary.cost.totalCost + rec.spentByChildren;
    if (totalSpent > budget) {
      logger.warn(`Agent "${rec.id}" exceeded budget $${budget}`, {
        ownSpent: rec.summary.cost.totalCost,
        childrenSpent: rec.spentByChildren,
      });
      this.completeInstance(rec.id, {
        status: 'cancelled',
        error: `Exceeded budget $${budget.toFixed(2)} (spent $${totalSpent.toFixed(4)})`,
      });
    }

    // Propagate cost to parent
    if (rec.parentId) {
      const parent = this.instances.get(rec.parentId);
      if (parent && !parent.completed) {
        this.updateParentChildCost(parent);
      }
    }
  }

  private updateParentChildCost(parent: InstanceRecord): void {
    let childTotal = 0;
    for (const inst of this.instances.values()) {
      if (inst.parentId === parent.id) {
        childTotal += inst.summary.cost.totalCost + inst.spentByChildren;
      }
    }
    parent.spentByChildren = childTotal;
  }

  private completeInstance(agentId: string, result: CompletionResult): void {
    const rec = this.instances.get(agentId);
    if (!rec || rec.completed) return;

    rec.completed = true;
    rec.completionResult = result;

    // Cascade cancellation to children
    if (result.status === 'cancelled' || result.status === 'error') {
      for (const [childId, child] of this.instances) {
        if (child.parentId === agentId && !child.completed) {
          this.completeInstance(childId, {
            status: 'cancelled',
            error: `Parent agent "${agentId}" ${result.status}`,
          });
        }
      }
    }

    // Clear timeout
    if (rec.timeoutHandle) {
      clearTimeout(rec.timeoutHandle);
      rec.timeoutHandle = undefined;
    }

    // Update summary
    const status: AgentStatus = result.status;
    const completedAt = Date.now();
    rec.summary.status = status;
    rec.summary.completedAt = completedAt;
    rec.summary.result = result.result;
    rec.summary.error = result.error;
    this.bridge.updateSummary(agentId, {
      status,
      completedAt,
      result: result.result,
      error: result.error,
    });
    this.notifySummariesChanged();

    // Resolve any waiters
    const waiters = rec.completionWaiters;
    rec.completionWaiters = [];
    for (const w of waiters) {
      try {
        w(result);
      } catch (err) {
        logger.error(`Completion waiter for "${agentId}" threw`, err);
      }
    }

    logger.info(`Agent "${agentId}" ${status}`, {
      result: result.result?.slice(0, 100),
      error: result.error,
    });

    // Keep the record around so query/list work after completion.
    // A follow-up could prune old ones after N minutes.
  }

  private teardownInstance(agentId: string): void {
    const rec = this.instances.get(agentId);
    if (!rec) return;

    if (!rec.completed) {
      // If still running, emit cancellation to any waiters before dispose
      this.completeInstance(agentId, { status: 'cancelled', error: 'Disposed' });
    }
    if (rec.timeoutHandle) {
      clearTimeout(rec.timeoutHandle);
    }
    try { rec.detach?.(); } catch { /* ignore */ }
    try { rec.host.dispose(); } catch (err) { logger.warn(`Agent "${agentId}" dispose error`, err); }

    this.bridge.notifyAgentDisposed(agentId);
    this.instances.delete(agentId);
    this.notifySummariesChanged();
  }
}

function truncateLabel(task: string): string {
  const trimmed = task.trim();
  if (trimmed.length <= 48) return trimmed;
  return trimmed.slice(0, 45).trimEnd() + '…';
}
