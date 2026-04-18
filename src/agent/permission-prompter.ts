import type { PermissionPolicy, PermissionOutcome, PermissionPrompter, PermissionMode, PermissionRequest } from '@sschepis/as-agent';

// PermissionMode enum values from as-agent
const PM = {
  ReadOnly: 0 as PermissionMode,
  WorkspaceWrite: 1 as PermissionMode,
  DangerFullAccess: 2 as PermissionMode,
  Prompt: 3 as PermissionMode,
  Allow: 4 as PermissionMode,
};

/**
 * Tools classified by risk level.
 */
const READ_ONLY_TOOLS = new Set([
  'file read', 'search glob', 'search grep',
  'git status', 'git diff', 'git log', 'git branch',
  'workspace diagnostics', 'workspace info', 'workspace open-files',
  'memory get', 'memory list', 'memory search',
  'user ask', 'user secret',
  'agent query', 'agent list',
  'surface list', 'route list', 'route info',
  'skill list', 'skill get',
  'vscode list',
  'ui screenshot', 'ui cursor',
  'peer list', 'peer status', 'peer ask-status',
  'help', 'ls', 'tree', 'find', 'pwd', 'history',
]);

const WRITE_TOOLS = new Set([
  'file write', 'file edit',
  'memory set', 'memory pin', 'memory unpin', 'memory delete', 'memory tag',
  'agent spawn', 'agent cancel',
  'surface create', 'surface update', 'surface delete', 'surface open',
  'route create', 'route update', 'route delete',
]);

const DANGEROUS_TOOLS = new Set([
  'shell run', 'shell background', 'shell terminal',
  'git commit', 'git stash',
  'vscode run',
  'ui move', 'ui click', 'ui drag', 'ui type', 'ui press',
  'peer dispatch', 'peer ask', 'peer cancel',
]);

export type PermissionModeLabel = 'readonly' | 'workspace-write' | 'full-access' | 'prompt';

/**
 * Creates a PermissionPolicy based on the user's settings.
 */
export function createPermissionPolicy(mode: PermissionModeLabel): PermissionPolicy {
  const sessionAllowList = new Set<string>();

  return {
    get activeMode(): PermissionMode {
      switch (mode) {
        case 'readonly': return PM.ReadOnly;
        case 'workspace-write': return PM.WorkspaceWrite;
        case 'full-access': return PM.DangerFullAccess;
        case 'prompt': return PM.Prompt;
      }
    },

    requiredModeFor(toolName: string): PermissionMode {
      if (READ_ONLY_TOOLS.has(toolName)) return PM.ReadOnly;
      if (WRITE_TOOLS.has(toolName)) return PM.WorkspaceWrite;
      if (DANGEROUS_TOOLS.has(toolName)) return PM.DangerFullAccess;
      return PM.ReadOnly;
    },

    authorize(toolName: string, _toolInput: string, _prompter: PermissionPrompter | null): PermissionOutcome {
      // Always allow read-only tools
      if (READ_ONLY_TOOLS.has(toolName)) {
        return { kind: 'allow' };
      }

      // Full access mode allows everything
      if (mode === 'full-access') {
        return { kind: 'allow' };
      }

      // Read-only mode denies writes and shell
      if (mode === 'readonly') {
        if (!READ_ONLY_TOOLS.has(toolName)) {
          return { kind: 'deny', reason: `Read-only mode: '${toolName}' is not allowed` };
        }
        return { kind: 'allow' };
      }

      // Workspace-write allows writes but not shell
      if (mode === 'workspace-write') {
        if (DANGEROUS_TOOLS.has(toolName)) {
          return { kind: 'deny', reason: `Workspace-write mode: '${toolName}' requires full-access mode` };
        }
        return { kind: 'allow' };
      }

      // Prompt mode: check session allowlist
      if (sessionAllowList.has(toolName)) {
        return { kind: 'allow' };
      }

      // Unknown or dangerous tool in prompt mode → deny (will trigger permission_denied event)
      if (WRITE_TOOLS.has(toolName) || DANGEROUS_TOOLS.has(toolName)) {
        return { kind: 'deny', reason: `Permission required for '${toolName}'` };
      }

      return { kind: 'allow' };
    },

    /** Called by the orchestrator when user approves a tool via the UI */
    addToAllowList(toolName: string): void {
      sessionAllowList.add(toolName);
    },

    /** Get the current session allow list (for debugging) */
    get allowList(): Set<string> {
      return sessionAllowList;
    },
  } as PermissionPolicy & { addToAllowList(name: string): void; allowList: Set<string> };
}
