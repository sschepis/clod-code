import type { AgentManager } from '../agent/agent-manager';

/**
 * Dependencies injected into the agent/* tool handlers at tool-tree
 * construction time. Mirrors the AskDeps / SecretDeps pattern so handlers
 * can reach manager state without relying on module globals.
 */
export interface AgentToolDeps {
  manager: AgentManager;
  /** The agentId of the caller. Foreground returns 'foreground'. */
  callerId: () => string;
}
