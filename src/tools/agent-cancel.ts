import type { AgentToolDeps } from './agent-deps';

/**
 * agent/cancel — cancel a running background agent.
 *
 * Args:
 *   instance_id  (required) the id of the agent to cancel
 *   reason       (optional) text reason shown in logs/UI
 */
export function createAgentCancelHandler(deps: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const instanceId =
      typeof kwargs.instance_id === 'string'
        ? kwargs.instance_id
        : typeof kwargs.agent_id === 'string'
        ? kwargs.agent_id
        : '';
    if (!instanceId) return '[ERROR] Missing required argument: instance_id';
    if (instanceId === 'foreground') {
      return '[ERROR] The foreground agent cannot be cancelled. Use /interrupt or clear the session.';
    }

    const reason = typeof kwargs.reason === 'string' ? kwargs.reason : 'Cancelled by caller';

    const record = deps.manager.get(instanceId);
    if (!record) return `[ERROR] Agent "${instanceId}" not found.`;
    if (record.summary.status !== 'running') {
      return `[INFO] Agent "${instanceId}" is already ${record.summary.status}.`;
    }

    const ok = await deps.manager.cancel(instanceId, reason);
    return ok
      ? `[SUCCESS] Agent "${instanceId}" cancelled.`
      : `[ERROR] Could not cancel agent "${instanceId}".`;
  };
}
