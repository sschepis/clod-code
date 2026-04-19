import type { PromptRole } from '../config/settings';
import type { AgentToolDeps } from './agent-deps';

/**
 * agent/spawn — create a background agent to run a task.
 *
 * Args:
 *   task         (required) the prompt the new agent should execute
 *   systemPrompt (optional) override the agent's system prompt
 *   provider     (optional) remote provider override (e.g. "gemini")
 *   model        (optional) remote model override (e.g. "gemini-2.0-flash")
 *   role         (optional) prompt routing role: "orchestrator", "planner", "actor", "summarizer"
 *   budget_usd   (optional) per-agent USD budget ceiling
 *   timeout_ms   (optional) per-agent timeout in ms
 *   await        (optional, boolean) wait for completion; default false
 *   label        (optional) short label for the UI strip
 */
export function createAgentSpawnHandler(deps: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const task = typeof kwargs.task === 'string' ? kwargs.task.trim() : '';
    if (!task) return '[ERROR] Missing required argument: task';

    const systemPrompt = typeof kwargs.systemPrompt === 'string' ? kwargs.systemPrompt : undefined;
    const provider = typeof kwargs.provider === 'string' ? kwargs.provider : undefined;
    const model = typeof kwargs.model === 'string' ? kwargs.model : undefined;
    const budgetUsd =
      typeof kwargs.budget_usd === 'number' && kwargs.budget_usd > 0
        ? kwargs.budget_usd
        : undefined;
    const timeoutMs =
      typeof kwargs.timeout_ms === 'number' && kwargs.timeout_ms > 0
        ? kwargs.timeout_ms
        : undefined;
    const shouldAwait = kwargs.await === true;
    const label = typeof kwargs.label === 'string' ? kwargs.label : undefined;
    const VALID_ROLES = ['orchestrator', 'planner', 'actor', 'summarizer'] as const;
    const rawRole = typeof kwargs.role === 'string' ? kwargs.role.trim().toLowerCase() : '';
    const role = (VALID_ROLES as readonly string[]).includes(rawRole) ? rawRole as PromptRole : undefined;

    const result = await deps.manager.spawn({
      task,
      systemPrompt,
      model: provider || model ? { provider, name: model } : undefined,
      role,
      budgetUsd,
      timeoutMs,
      parentId: deps.callerId() === 'foreground' ? undefined : deps.callerId(),
      label,
    });

    if (!result.ok) {
      return `[ERROR] ${result.error}`;
    }

    if (!shouldAwait) {
      return (
        `[SUCCESS] Spawned background agent "${result.agentId}". ` +
        `It is running asynchronously. Use \`agent query\` with instance_id="${result.agentId}" ` +
        `to check status, or \`agent list\` to see all agents.`
      );
    }

    // Await path — block until the agent finishes or errors
    const completion = await deps.manager.waitForCompletion(result.agentId);
    if (completion.status === 'complete') {
      return (
        `[SUCCESS] Agent "${result.agentId}" completed.\n\n` +
        `Result:\n${completion.result ?? '(no output)'}`
      );
    }
    if (completion.status === 'cancelled') {
      return `[CANCELLED] Agent "${result.agentId}" was cancelled: ${completion.error ?? 'no reason'}`;
    }
    return `[ERROR] Agent "${result.agentId}" failed: ${completion.error ?? 'unknown error'}`;
  };
}
