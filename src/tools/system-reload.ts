import type { AgentToolDeps } from './agent-deps';

export function createSystemReloadHandler(deps: AgentToolDeps) {
  return async (): Promise<string> => {
    // We can ask the manager to reload the tool tree for the caller
    const callerId = deps.callerId();
    const success = deps.manager.reloadToolTree(callerId);
    if (success) {
      return 'Tool tree reloaded successfully. Custom tools have been refreshed.';
    } else {
      return '[ERROR] Failed to reload tool tree. Agent not found.';
    }
  };
}
