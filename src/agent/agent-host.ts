/**
 * AgentHost — owns a single ObotoAgent instance and translates its events
 * into UI-neutral AgentEvents that any subscriber (webview bridge, test,
 * other agent) can consume.
 *
 * An AgentHost knows nothing about the webview. It only:
 * - creates and disposes the underlying ObotoAgent
 * - wires the agent's event bus to its own subscribers
 * - exposes submit/interrupt/getSession
 *
 * Multiple AgentHost instances coexist (foreground + spawned background
 * agents) managed by AgentManager.
 */

import type { ObotoAgent as ObotoAgentType } from '@sschepis/oboto-agent';
import type { Session, AgentRuntime } from '@sschepis/as-agent';
import type { Router } from '@sschepis/swiss-army-tool';

import type { ObotovsSettings, PromptRole } from '../config/settings';
import type { ModelInfo } from '../shared/message-types';
import type { SkillManager } from '../skills/skill-manager';
import type { ProjectManager } from '../projects/project-manager';
import { DEFAULT_MODEL_PRICING, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PRESERVE_RECENT_MESSAGES } from '../config/defaults';
import { createProviders, resolveRole } from './providers';
import { createDWIMProvider } from './dwim-provider';
import { buildSystemPrompt } from './system-prompt';
import { createPermissionPolicy, type PermissionModeLabel } from './permission-prompter';
import { logger } from '../shared/logger';
import { dynamicImport } from '../shared/dynamic-import';
import { getErrorMessage } from '../shared/errors';
import { getProviderMeta } from '../config/provider-registry';
import { getSpinnerMessage } from './spinner-messages';
import { AlephMeshSync } from './aleph-mesh-sync';

// ── UI-neutral event types ─────────────────────────────────────────────

export type HostEvent =
  | { type: 'phase'; phase: string; message: string }
  | { type: 'triage'; reasoning: string; escalate: boolean }
  | { type: 'thought'; text: string; model?: string; iteration?: number }
  | { type: 'token'; text: string }
  | { type: 'tool_start'; command: string; kwargs?: Record<string, unknown> }
  | { type: 'tool_complete'; command: string; result?: string; error?: string; durationMs?: number }
  | { type: 'tool_round'; narrative: string; iteration: number; totalToolCalls: number }
  | { type: 'turn_complete'; iterations?: number; toolCalls?: number; usage?: unknown }
  | { type: 'cost'; totalTokens: number; totalCost: number }
  | { type: 'permission_denied'; toolName: string; toolInput: string; reason: string }
  | { type: 'error'; message: string }
  | { type: 'doom_loop'; reason: string; command: string }
  | { type: 'session_compacted'; summary: string; formattedSummary: string; removedMessageCount: number }
  | { type: 'initialized'; model: ModelInfo; triageModel?: ModelInfo }
  | { type: 'disposed' };

interface ToolSnapshot {
  command: string;
  target: string;
  result: string;
  success: boolean;
}

export type HostEventListener = (event: HostEvent) => void;

// ── Config ──────────────────────────────────────────────────────────────

export interface AgentHostConfig {
  id: string;
  settings: ObotovsSettings;
  router: Router;
  agentRuntime?: AgentRuntime;
  /** Initial session; omit for empty. */
  initialSession?: Session;
  /** System prompt override. If omitted, uses the default workspace prompt. */
  systemPromptOverride?: string;
  /** Permission mode override (e.g. background agents may run readonly). */
  permissionModeOverride?: PermissionModeLabel;
  /** Optional skill manager — when provided, skills are listed in the system prompt. */
  skills?: SkillManager;
  /** Optional project manager — when provided, active project context is appended. */
  projects?: ProjectManager;
  /** Routing role — controls which provider/model is used from the routing config. */
  role?: PromptRole;
}

// ── AgentHost ───────────────────────────────────────────────────────────

export class AgentHost {
  public readonly id: string;
  private agent?: ObotoAgentType;
  private settings: ObotovsSettings;
  private router: Router;
  private agentRuntime?: AgentRuntime;
  private permissionPolicy?: ReturnType<typeof createPermissionPolicy>;
  private systemPromptOverride?: string;
  private permissionModeOverride?: PermissionModeLabel;
  private skills?: SkillManager;
  private projects?: ProjectManager;
  private role?: PromptRole;
  private activeModel: ModelInfo;
  private triageModel: ModelInfo | undefined;
  private disposed = false;
  private meshSync?: AlephMeshSync;
  private listeners = new Set<HostEventListener>();
  private pendingInput: string | null = null;

  // ── Provider state ──
  public remoteProvider?: import('@sschepis/llm-wrapper').BaseProvider;
  public remoteModelName?: string;
  private _localProvider?: import('@sschepis/llm-wrapper').BaseProvider;
  private _localModelName?: string;

  getLocalProvider() { return this._localProvider; }
  getLocalModelName() { return this._localModelName; }
  getCompactionCount(): number { return this.compactionCount; }
  getConversationRAG() { return this.agent?.getConversationRAG(); }
  getSessionCompactor() { return this.agent?.getSessionCompactor(); }

  private toolLog: ToolSnapshot[] = [];
  private targetFrequency = new Map<string, number>();
  private editTargets = new Set<string>();
  private readTargets = new Set<string>();
  private lastUserInput = '';
  private currentIteration = 0;
  private lastChaperoneIteration = 0;
  private compactionCount = 0;
  private triageFailCount = 0;
  private triageCircuitOpen = false;
  private triageCircuitOpenedAt = 0;
  private static readonly TRIAGE_FAIL_THRESHOLD = 3;
  private static readonly TRIAGE_CIRCUIT_COOLDOWN_MS = 120_000;

  constructor(config: AgentHostConfig) {
    this.id = config.id;
    this.settings = config.settings;
    this.router = config.router;
    this.agentRuntime = config.agentRuntime;
    this.systemPromptOverride = config.systemPromptOverride;
    this.permissionModeOverride = config.permissionModeOverride;
    this.skills = config.skills;
    this.projects = config.projects;
    this.role = config.role;
    this.activeModel = this.computeActiveModel();
    this.triageModel = this.computeTriageModel();
  }

  /** Subscribe to host events. Returns an unsubscribe function. */
  on(listener: HostEventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Initialize and create the underlying ObotoAgent. */
  async initialize(existingSession?: Session): Promise<void> {
    if (this.disposed) throw new Error(`AgentHost ${this.id} already disposed`);
    await this.createAgent(existingSession);
  }

  /** Recreate the agent with new settings while preserving the session. */
  async recreate(newSettings: ObotovsSettings): Promise<void> {
    if (this.disposed) return;
    this.settings = newSettings;
    const session = this.agent?.getSession();
    this.teardownAgent();
    await this.createAgent(session);
  }

  /** Recreate the agent with a fresh (empty) session, discarding history. */
  async recreateClean(newSettings?: ObotovsSettings): Promise<void> {
    if (this.disposed) return;
    if (newSettings) this.settings = newSettings;
    this.teardownAgent();
    await this.createAgent(undefined);
  }

  /** Submit user or task input to the agent. */
  async submit(text: string, attachments?: any[]): Promise<void> {
    if (!this.agent) {
      this.emit({ type: 'error', message: `Agent ${this.id} is not initialized` });
      return;
    }
    if (this.isProcessing) {
      this.pendingInput = text;
      logger.info(`AgentHost "${this.id}": queued input while processing`);
      return;
    }
    const newTriageModel = this.computeTriageModel();
    const triageChanged = (!!newTriageModel) !== (!!this.triageModel);
    if (triageChanged) {
      this.triageModel = newTriageModel;
      const session = this.agent.getSession();
      this.teardownAgent();
      await this.createAgent(session);
    }
    this.lastUserInput = text;
    this.toolLog = [];
    this.targetFrequency.clear();
    this.editTargets.clear();
    this.readTargets.clear();
    await this.agent!.submitInput(text);
  }

  async interrupt(): Promise<void> {
    if (!this.agent) return;
    await this.agent.interrupt();
    if (this.isProcessing) {
      await this.forceStopAfterTimeout(2000);
    }
  }

  private forceStopAfterTimeout(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const interval = 200;
      let elapsed = 0;

      const poll = setInterval(() => {
        elapsed += interval;
        if (!this.isProcessing || !this.agent) {
          clearInterval(poll);
          resolve();
          return;
        }
        if (elapsed >= timeoutMs) {
          clearInterval(poll);
          logger.info(`AgentHost "${this.id}": force-stopping after ${timeoutMs}ms`);
          const session = this.agent?.getSession();
          this.pendingInput = null;
          this.teardownAgent();
          this.emit({ type: 'turn_complete' });
          this.createAgent(session).catch((err) => {
            logger.error(`AgentHost "${this.id}": failed to recreate after force-stop`, err);
            this.emit({ type: 'error', message: getErrorMessage(err) });
          });
          resolve();
        }
      }, interval);
    });
  }

  getSession(): Session | undefined {
    return this.agent?.getSession();
  }

  async syncSession(session: Session): Promise<void> {
    await this.agent?.syncSession(session);
  }

  setRouter(router: Router): void {
    this.router = router;
  }

  getRouter(): Router {
    return this.router;
  }

  getActiveModel(): ModelInfo {
    return this.activeModel;
  }

  getTriageModel(): ModelInfo | undefined {
    return this.triageModel;
  }

  getCostSummary() {
    return this.agent?.getUnifiedCostSummary?.() ?? null;
  }

  getSlashCommands() {
    return this.agent?.getSlashCommands?.() ?? undefined;
  }

  getPermissionPolicy() {
    return this.permissionPolicy;
  }

  get isProcessing(): boolean {
    return this.agent?.processing ?? false;
  }

  /** Idempotent dispose — safe to call from cancel and natural-completion paths. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardownAgent();
    this.emit({ type: 'disposed' });
    this.listeners.clear();
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async createAgent(existingSession?: Session): Promise<void> {
    if (this.disposed) return;
    try {
      const { ObotoAgent, createEmptySession } = await dynamicImport<
        typeof import('@sschepis/oboto-agent')
      >('@sschepis/oboto-agent');

      this.activeModel = this.computeActiveModel();
      this.triageModel = this.computeTriageModel();

      const providers = await createProviders(this.settings, this.role);
      this._localProvider = createDWIMProvider(providers.local);
      this._localModelName = providers.localModelName;
      this.remoteProvider = createDWIMProvider(providers.remote);
      this.remoteModelName = providers.remoteModelName;
      const systemPrompt =
        this.systemPromptOverride ??
        buildSystemPrompt({
          instructionFileName: this.settings.instructionFile,
          skills: this.skills,
          projects: this.projects,
        });
      const session = existingSession ?? createEmptySession();

      const permMode = this.permissionModeOverride ?? this.settings.permissionMode;
      const basePolicy = createPermissionPolicy(permMode) as any;
      this.permissionPolicy = {
        get allowList() { return basePolicy.allowList; },
        addToAllowList: (cmd: string) => basePolicy.addToAllowList(cmd),
        requiredModeFor: (cmd: string) => basePolicy.requiredModeFor(cmd),
        authorize: async (toolName: string, toolInput: any) => {
          if (this.currentIteration - this.lastChaperoneIteration >= this.settings.maxIterations * 2) {
            this.emit({ type: 'phase', phase: 'chaperone', message: 'Chaperone is evaluating progress...' });
            const chaperoneResult = await this.invokeChaperone();
            this.lastChaperoneIteration = this.currentIteration;
            if (chaperoneResult === 'abort') {
              return { kind: 'deny', reason: 'Chaperone Agent halted execution due to lack of productive progress.' };
            }
          }
          return basePolicy.authorize(toolName, toolInput);
        }
      } as any;

      this.agent = new ObotoAgent({
        localModel: this._localProvider as any,
        remoteModel: this.remoteProvider as any,
        localModelName: providers.localModelName,
        remoteModelName: providers.remoteModelName,
        router: this.router as any,
        session,
        systemPrompt,
        maxIterations: 9999,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        onToken: (token) => this.emit({ type: 'token', text: token }),
        permissionPolicy: this.permissionPolicy as any,
        compactionConfig: this.settings.autoCompact
          ? {
              preserveRecentMessages: DEFAULT_PRESERVE_RECENT_MESSAGES,
              maxEstimatedTokens: this.settings.autoCompactThreshold,
            }
          : undefined,
        agentRuntime: this.agentRuntime,
        modelPricing: DEFAULT_MODEL_PRICING,
        maxContextTokens: this.settings.maxContextTokens,
      });

      this.wireEvents();

      if (process.env.ALEPH_MESH_URL) {
        this.meshSync = new AlephMeshSync((this.agent as any).bus);
      }

      this.activeModel = { ...this.activeModel, ready: true };
      if (this.triageModel) this.triageModel = { ...this.triageModel, ready: true };
      this.emit({ type: 'initialized', model: this.activeModel, triageModel: this.triageModel });

      logger.info(`AgentHost "${this.id}" initialized`, {
        triageModel: providers.localModelName,
        executorModel: providers.remoteModelName,
      });
    } catch (err) {
      const msg = getErrorMessage(err);
      logger.error(`AgentHost "${this.id}" failed to create`, err);
      this.emit({ type: 'error', message: this.decorateInitError(msg) });
    }
  }

  private wireEvents(): void {
    if (!this.agent) return;
    const a = this.agent;

    const SPINNER_PHASES = new Set(['thinking', 'tools', 'planning', 'precheck', 'continuation', 'memory', 'chaperone']);
    a.on('phase', (e) => {
      const p = e.payload as { phase: string; message: string };
      const message = SPINNER_PHASES.has(p.phase)
        ? (this.settings.fancySpinner ? getSpinnerMessage() : '')
        : p.message;
      this.emit({ type: 'phase', phase: p.phase, message });
    });

    a.on('triage_result', (e) => {
      const p = e.payload as { escalate: boolean; reasoning: string };
      this.emit({ type: 'triage', reasoning: p.reasoning, escalate: p.escalate });
    });

    a.on('agent_thought', (e) => {
      const p = e.payload as { text: string; model?: string; iteration?: number };
      if (!p?.text) return;
      this.emit({ type: 'thought', text: p.text, model: p.model, iteration: p.iteration });
    });

    a.on('tool_execution_start', (e) => {
      const p = e.payload as { command: string; kwargs?: Record<string, unknown> | string };
      let kwargs = p.kwargs;
      if (typeof kwargs === 'string') {
        try { kwargs = JSON.parse(kwargs); } catch { kwargs = undefined; }
      }
      this.emit({ type: 'tool_start', command: String(p.command), kwargs: kwargs as Record<string, unknown> | undefined });
    });

    a.on('tool_execution_complete', (e) => {
      const p = e.payload as { command: string; result?: string; error?: string; durationMs?: number; kwargs?: Record<string, unknown> };
      const target = this.extractTarget(p.kwargs);
      this.toolLog.push({
        command: String(p.command),
        target,
        result: (p.result || p.error || '').slice(0, 200),
        success: !p.error,
      });
      if (this.toolLog.length > 12) this.toolLog.shift();
      if (target) {
        this.targetFrequency.set(target, (this.targetFrequency.get(target) ?? 0) + 1);
        const cmd = String(p.command).toLowerCase();
        if (cmd.includes('write') || cmd.includes('edit') || cmd.includes('patch')) {
          this.editTargets.add(target);
        } else if (cmd.includes('read') || cmd.includes('cat') || cmd.includes('view')) {
          this.readTargets.add(target);
        }
      }
      this.emit({
        type: 'tool_complete',
        command: String(p.command),
        result: p.result,
        error: p.error,
        durationMs: p.durationMs,
      });
    });

    a.on('tool_round_complete', (e) => {
      const p = e.payload as { narrative: string; iteration: number; totalToolCalls: number };
      this.currentIteration = p.iteration;
      this.emit({
        type: 'tool_round',
        narrative: p.narrative,
        iteration: p.iteration,
        totalToolCalls: p.totalToolCalls,
      });
    });

    a.on('turn_complete', (e) => {
      const p = e.payload as { iterations?: number; toolCalls?: number; usage?: unknown };
      this.emit({
        type: 'turn_complete',
        iterations: p.iterations,
        toolCalls: p.toolCalls,
        usage: p.usage,
      });
      this.drainPendingInput();
    });

    a.on('cost_update', (e) => {
      const p = e.payload as { totalTokens?: number; totalCost?: number };
      this.emit({
        type: 'cost',
        totalTokens: p.totalTokens ?? 0,
        totalCost: p.totalCost ?? 0,
      });
    });

    a.on('permission_denied', (e) => {
      const p = e.payload as { toolName: string; toolInput: string; reason: string };
      this.emit({
        type: 'permission_denied',
        toolName: p.toolName,
        toolInput: p.toolInput,
        reason: p.reason,
      });
    });

    a.on('error', (e) => {
      const p = e.payload as { message: string };
      const raw = p?.message ?? 'Unknown error';

      if (this.isTriageError(raw)) {
        this.triageFailCount++;
        if (this.triageFailCount >= AgentHost.TRIAGE_FAIL_THRESHOLD && !this.triageCircuitOpen) {
          this.triageCircuitOpen = true;
          this.triageCircuitOpenedAt = Date.now();
          logger.warn(`AgentHost "${this.id}": triage circuit breaker OPEN after ${this.triageFailCount} failures`);
          this.emit({
            type: 'error',
            message: `Triage model unreachable after ${this.triageFailCount} attempts. ` +
              `Requests will bypass triage and go directly to the executor for the next 2 minutes. ` +
              `Please retry your last message.`,
          });
          return;
        }
      } else {
        this.triageFailCount = 0;
      }

      this.emit({ type: 'error', message: this.decorateRuntimeError(raw) });
      if (this.pendingInput) {
        const lost = this.pendingInput;
        this.pendingInput = null;
        logger.warn(`AgentHost "${this.id}": discarded queued input due to error: "${lost.slice(0, 80)}"`);
        this.emit({ type: 'error', message: 'A queued message was discarded due to the error above. Please re-send it.' });
      }
    });

    a.on('doom_loop', (e) => {
      const p = e.payload as { reason: string; command: string };
      this.emit({ type: 'doom_loop', reason: p.reason, command: p.command });
    });

    a.on('session_compacted', (e) => {
      const p = e.payload as { summary: string; formattedSummary: string; removedMessageCount: number };
      this.compactionCount++;
      logger.info(`AgentHost "${this.id}": session compacted (#${this.compactionCount}), removed ${p.removedMessageCount} messages`);
      this.emit({
        type: 'session_compacted',
        summary: p.summary,
        formattedSummary: p.formattedSummary,
        removedMessageCount: p.removedMessageCount,
      });
    });
  }

  private drainPendingInput(): void {
    const text = this.pendingInput;
    if (!text || !this.agent) return;
    this.pendingInput = null;
    logger.info(`AgentHost "${this.id}": submitting queued input`);
    this.agent.submitInput(text).catch((err) => {
      logger.error(`AgentHost "${this.id}": failed to submit queued input`, err);
      this.emit({ type: 'error', message: getErrorMessage(err) });
    });
  }

  // ── Chaperone engine ─────────────────────────────────────────────────

  private computeProgressSignals(): { repeatedTargets: string[]; uniqueTargets: number; editCount: number; readWriteOverlap: string[] } {
    const repeated: string[] = [];
    for (const [target, count] of this.targetFrequency) {
      if (count >= 3) repeated.push(`${target} (${count}x)`);
    }
    const readWriteOverlap = [...this.editTargets].filter(t => this.readTargets.has(t));
    return {
      repeatedTargets: repeated,
      uniqueTargets: this.targetFrequency.size,
      editCount: this.editTargets.size,
      readWriteOverlap,
    };
  }

  private async invokeChaperone(): Promise<'continue' | 'abort'> {
    for (const [target, count] of this.targetFrequency) {
      if (count >= 8) {
        logger.warn(`AgentHost "${this.id}": Chaperone fast-abort — target "${target}" accessed ${count} times`);
        this.emit({
          type: 'doom_loop',
          reason: `Target "${target}" accessed ${count} times — likely stuck in a loop`,
          command: 'chaperone:fast-abort',
        });
        return 'abort';
      }
    }

    if (!this.remoteProvider || !this.remoteModelName) return 'continue';
    const provider = this.remoteProvider;
    const model = this.remoteModelName;

    const recentLog = this.toolLog.map(t =>
      `- [${t.success ? 'OK' : 'ERR'}] ${t.command} → ${t.target || '(no target)'} | ${t.result.slice(0, 80)}`
    ).join('\n');

    const signals = this.computeProgressSignals();
    const compactionNote = this.compactionCount > 0
      ? `\nNote: Session compacted ${this.compactionCount} time(s). Shorter history does NOT indicate lack of progress.\n`
      : '';

    let warningBlock = '';
    if (signals.repeatedTargets.length > 0) {
      warningBlock += `\nREPEATED TARGETS (3+ accesses): ${signals.repeatedTargets.join(', ')}`;
    }
    if (signals.readWriteOverlap.length > 0) {
      warningBlock += `\nREAD-AFTER-WRITE on: ${signals.readWriteOverlap.join(', ')} — may indicate edit/revert cycles`;
    }

    const prompt = `You are a chaperone evaluating whether an AI agent is making genuine progress.

User's original request: "${this.lastUserInput.slice(0, 300)}"

The agent has been running for ${this.currentIteration} iterations.
${compactionNote}
Progress metrics:
- Unique targets touched: ${signals.uniqueTargets}
- Files edited: ${signals.editCount}
${warningBlock}

Recent tool calls (last ${this.toolLog.length}):
${recentLog}

Evaluate:
1. Is the agent making FORWARD progress toward the user's goal?
2. Are there signs of a doom loop (same targets read repeatedly, edits that revert, repeated errors)?
3. Is the ratio of unique productive actions to total actions reasonable?

Respond ONLY with JSON: {"status": "continue" | "abort", "reasoning": "..."}`;

    try {
      const CHAPERONE_TIMEOUT_MS = 10_000;
      const chatPromise = provider.chat({
        model,
        messages: [{ role: 'user' as const, content: prompt }],
        max_tokens: 200,
      });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), CHAPERONE_TIMEOUT_MS));
      const res = await Promise.race([chatPromise, timeoutPromise]);
      if (!res) {
        logger.warn(`AgentHost "${this.id}": Chaperone timed out after ${CHAPERONE_TIMEOUT_MS}ms`);
        return 'continue';
      }
      const content = (res?.choices?.[0]?.message?.content as string)?.trim() || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.status === 'abort') {
          logger.warn(`AgentHost "${this.id}": Chaperone aborted. Reason: ${parsed.reasoning}`);
          return 'abort';
        }
      }
      return 'continue';
    } catch (err) {
      logger.error(`AgentHost "${this.id}": Chaperone failed`, err);
      return 'continue';
    }
  }

  private extractTarget(kwargs?: Record<string, unknown>): string {
    if (!kwargs) return '';
    const p = (kwargs.path ?? kwargs.file ?? kwargs.filePath ?? kwargs.file_path ?? '') as string;
    if (p) {
      const parts = p.split('/');
      return parts.length > 2 ? parts.slice(-2).join('/') : parts[parts.length - 1];
    }
    const q = (kwargs.pattern ?? kwargs.query ?? kwargs.cmd ?? '') as string;
    if (q) return String(q).slice(0, 50);
    return '';
  }

  private teardownAgent(): void {
    if (this.meshSync) {
      this.meshSync.dispose();
      this.meshSync = undefined;
    }
    try {
      this.agent?.removeAllListeners?.();
    } catch (err) {
      logger.warn(`AgentHost "${this.id}" teardown error`, err);
    }
    this.agent = undefined;
  }

  private emit(event: HostEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error(`HostEvent listener threw for agent "${this.id}"`, err);
      }
    }
  }

  private computeActiveModel(): ModelInfo {
    try {
      const resolved = resolveRole(this.role ?? 'executor', this.settings);
      const providerMeta = getProviderMeta(resolved.providerType);

      return {
        provider: resolved.providerId,
        providerDisplayName: providerMeta?.displayName ?? resolved.providerId,
        model: resolved.model,
        isLocal: providerMeta?.isLocal ?? false,
        ready: false,
      };
    } catch {
      return {
        provider: 'unknown',
        model: 'unknown',
        isLocal: false,
        ready: false,
      };
    }
  }

  private computeTriageModel(): ModelInfo | undefined {
    if (!this.settings.triageEnabled) return undefined;
    if (this.triageCircuitOpen) {
      if (Date.now() - this.triageCircuitOpenedAt < AgentHost.TRIAGE_CIRCUIT_COOLDOWN_MS) {
        return undefined;
      }
      this.triageCircuitOpen = false;
      this.triageFailCount = 0;
      logger.info(`AgentHost "${this.id}": triage circuit breaker half-open — allowing retry`);
    }
    try {
      const resolved = resolveRole('triage', this.settings);
      const providerMeta = getProviderMeta(resolved.providerType);
      return {
        provider: resolved.providerId,
        providerDisplayName: providerMeta?.displayName ?? resolved.providerId,
        model: resolved.model,
        isLocal: providerMeta?.isLocal ?? false,
        ready: false,
      };
    } catch {
      return undefined;
    }
  }

  private decorateInitError(raw: string): string {
    let hint = '';
    if (/Cannot find module/.test(raw)) {
      hint =
        "\n\nThis usually means the provider SDK isn't installed. " +
        'Open Oboto VS Settings and pick a different provider, or check the logs for details.';
    } else if (/API key|apiKey/i.test(raw)) {
      hint = '\n\nConfigure your API key: Command Palette → "Oboto VS: Open Settings".';
    } else if (/Mismatch:/i.test(raw)) {
      hint = '\n\nOpen Oboto VS Settings and make sure the provider and model match.';
    } else if (/ECONNREFUSED|fetch failed/i.test(raw)) {
      hint =
        "\n\nCan't reach the server. Check that the base URL is correct and the service is running.";
    }
    return `Failed to initialize agent: ${raw}${hint}`;
  }

  private isTriageError(msg: string): boolean {
    return /Compilation failed for "triage"/i.test(msg)
      || /triage.*ECONNREFUSED/i.test(msg)
      || /triage.*fetch failed/i.test(msg)
      || /triage.*timeout/i.test(msg)
      || /triage.*unreachable/i.test(msg);
  }

  private decorateRuntimeError(raw: string): string {
    if (/Compilation failed for "triage"/i.test(raw)) {
      const triage = this.settings.routing?.triage;
      const triageLabel = triage ? `${triage.providerId}/${triage.model || 'default'}` : 'triage model';
      return (
        `The triage step failed because the triage model (${triageLabel}) ` +
        `couldn't produce valid structured JSON.\n\n` +
        `Fix: Open Oboto Settings and **uncheck "Enable dual-LLM triage"**, ` +
        `or assign a stronger model to the Triage role.`
      );
    }
    if (/Compilation failed/i.test(raw)) {
      return (
        `${raw}\n\nThis usually means the LLM returned text that didn't match the expected JSON schema. ` +
        `Try a different model or disable dual-LLM triage in Oboto VS Settings.`
      );
    }
    return raw;
  }
}
