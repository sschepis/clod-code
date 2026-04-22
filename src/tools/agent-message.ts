import type { AgentToolDeps } from './agent-deps';

/**
 * agent/message — Send a message to a specific agent (e.g. another chat panel)
 *
 * Args:
 *   agent_id (required) The target agent ID
 *   message  (required) The message to send
 */
export function createAgentMessageHandler(deps: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const agentId = typeof kwargs.agent_id === 'string' ? kwargs.agent_id : '';
    const message = typeof kwargs.message === 'string' ? kwargs.message : '';

    if (!agentId || !message) {
      return '[ERROR] Missing required arguments: agent_id, message';
    }

    const record = deps.manager.get(agentId);
    if (!record) {
      return `[ERROR] Agent "${agentId}" not found.`;
    }

    // Append the message to the target agent's UI so it shows up in their chat
    const bridge = deps.manager.getBridge();
    bridge.appendEvent(agentId, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    // Submit the message to the agent host
    await record.host.submit(message);

    return `[SUCCESS] Sent message to agent "${agentId}".`;
  };
}
