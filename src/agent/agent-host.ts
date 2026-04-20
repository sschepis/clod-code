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
import { DEFAULT_MODEL_PRICING, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PRESERVE_RECENT_MESSAGES } from '../config/defaults';
import { createProviders, resolveRole } from './providers';
import { buildSystemPrompt } from './system-prompt';
import { createPermissionPolicy, type PermissionModeLabel } from './permission-prompter';
import { logger } from '../shared/logger';
import { dynamicImport } from '../shared/dynamic-import';
import { getErrorMessage } from '../shared/errors';
import { getProviderMeta } from '../config/provider-registry';

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
  | { type: 'initialized'; model: ModelInfo }
  | { type: 'disposed' };

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
  private role?: PromptRole;
  private activeModel: ModelInfo;
  private disposed = false;
  private listeners = new Set<HostEventListener>();
  private pendingInput: string | null = null;

  constructor(config: AgentHostConfig) {
    this.id = config.id;
    this.settings = config.settings;
    this.router = config.router;
    this.agentRuntime = config.agentRuntime;
    this.systemPromptOverride = config.systemPromptOverride;
    this.permissionModeOverride = config.permissionModeOverride;
    this.skills = config.skills;
    this.role = config.role;
    this.activeModel = this.computeActiveModel();
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
    await this.agent.submitInput(text, attachments);
  }

  async interrupt(): Promise<void> {
    if (!this.agent) return;
    await this.agent.interrupt();
  }

  getSession(): Session | undefined {
    return this.agent?.getSession();
  }

  setRouter(router: Router): void {
    this.router = router;
  }

  getActiveModel(): ModelInfo {
    return this.activeModel;
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
    try {
      const { ObotoAgent, createEmptySession } = await dynamicImport<
        typeof import('@sschepis/oboto-agent')
      >('@sschepis/oboto-agent');

      this.activeModel = this.computeActiveModel();

      const providers = await createProviders(this.settings, this.role);
      const systemPrompt =
        this.systemPromptOverride ??
        buildSystemPrompt({
          instructionFileName: this.settings.instructionFile,
          skills: this.skills,
        });
      const session = existingSession ?? createEmptySession();

      const permMode = this.permissionModeOverride ?? this.settings.permissionMode;
      this.permissionPolicy = createPermissionPolicy(permMode);

      this.agent = new ObotoAgent({
        localModel: providers.local,
        remoteModel: providers.remote,
        localModelName: providers.localModelName,
        remoteModelName: providers.remoteModelName,
        router: this.router,
        session,
        systemPrompt,
        maxIterations: this.settings.maxIterations,
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

      this.activeModel = { ...this.activeModel, ready: true };
      this.emit({ type: 'initialized', model: this.activeModel });

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

    a.on('phase', (e) => {
      const p = e.payload as { phase: string; message: string };
      this.emit({ type: 'phase', phase: p.phase, message: p.message });
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
      const p = e.payload as { command: string; kwargs?: Record<string, unknown> };
      this.emit({ type: 'tool_start', command: String(p.command), kwargs: p.kwargs });
    });

    a.on('tool_execution_complete', (e) => {
      const p = e.payload as { command: string; result?: string; error?: string; durationMs?: number };
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
      this.emit({ type: 'error', message: this.decorateRuntimeError(raw) });
    });

    a.on('doom_loop', (e) => {
      const p = e.payload as { reason: string; command: string };
      this.emit({ type: 'doom_loop', reason: p.reason, command: p.command });
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

  private teardownAgent(): void {
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
