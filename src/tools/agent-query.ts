import type { AgentToolDeps } from './agent-deps';

/**
 * agent/query — get the status and (if finished) result of a background agent.
 *
 * Args:
 *   instance_id  (required) the id returned from agent/spawn
 */
export function createAgentQueryHandler(deps: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const instanceId =
      typeof kwargs.instance_id === 'string'
        ? kwargs.instance_id
        : typeof kwargs.agent_id === 'string'
        ? kwargs.agent_id
        : '';
    if (!instanceId) return '[ERROR] Missing required argument: instance_id';

    const record = deps.manager.get(instanceId);
    if (!record) return `[ERROR] Agent "${instanceId}" not found.`;

    const s = record.summary;
    const lines: string[] = [
      `Agent: ${s.id}`,
      `Label: ${s.label}`,
      `Status: ${s.status}`,
      `Model: ${s.model.providerDisplayName ?? s.model.provider} / ${s.model.model}`,
      `Cost: $${s.cost.totalCost.toFixed(4)} (${s.cost.totalTokens} tokens)`,
      `Started: ${new Date(s.createdAt).toISOString()}`,
    ];
    if (s.completedAt) {
      lines.push(`Completed: ${new Date(s.completedAt).toISOString()}`);
      const durationMs = s.completedAt - s.createdAt;
      lines.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    }
    if (s.task) lines.push(`\nTask:\n${s.task}`);
    if (s.result) lines.push(`\nResult:\n${s.result}`);
    if (s.error) lines.push(`\nError:\n${s.error}`);

    return lines.join('\n');
  };
}
