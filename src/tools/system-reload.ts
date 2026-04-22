import type { AgentToolDeps } from './agent-deps';

export function createSystemReloadHandler(deps: AgentToolDeps) {
  return async (): Promise<string> => {
    // We can ask the manager to reload the tool tree for the caller
    const callerId = deps.callerId();
    const success = deps.manager.reloadToolTree(callerId);
    if (success) {
      return '[SUCCESS] Tool tree reloaded. Custom tools from .obotovs/tools/ have been refreshed. Use `help custom` to see available custom tools.';
    } else {
      return `[ERROR] Failed to reload tool tree — no agent found with id "${callerId}". This can happen if the agent was cancelled or its session expired. Try running a command like \`help\` to verify your session is active.`;
    }
  };
}
