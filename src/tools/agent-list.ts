import type { AgentToolDeps } from './agent-deps';

/**
 * agent/list — list background agents.
 *
 * Args:
 *   filter  (optional) 'running' | 'complete' | 'all'; default 'all'
 */
export function createAgentListHandler(deps: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filterArg =
      typeof kwargs.filter === 'string' ? kwargs.filter.toLowerCase() : 'all';
    const filter: 'running' | 'complete' | 'all' =
      filterArg === 'running' || filterArg === 'complete' ? filterArg : 'all';

    const agents = deps.manager.list(filter);
    if (agents.length === 0) {
      return filter === 'all'
        ? '[INFO] No background agents.'
        : `[INFO] No ${filter} background agents.`;
    }

    const rows = agents.map((a) => {
      const cost = `$${a.cost.totalCost.toFixed(4)}`;
      const ago = agoString(Date.now() - a.createdAt);
      return `  ${a.id}  [${a.status.padEnd(9)}]  ${cost.padStart(8)}  ${ago.padStart(6)}  ${a.label}`;
    });

    return (
      `[SUCCESS] ${agents.length} agent${agents.length === 1 ? '' : 's'} ` +
      `(filter: ${filter}):\n\n` +
      `  ID                              STATUS        COST       AGE   LABEL\n` +
      rows.join('\n')
    );
  };
}

function agoString(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
