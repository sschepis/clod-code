import type { AgentToolDeps } from './agent-deps';

export function createAgentCollectHandler(deps: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    let ids: string[];
    try {
      const raw = typeof kwargs.instance_ids === 'string'
        ? JSON.parse(kwargs.instance_ids)
        : kwargs.instance_ids;
      if (!Array.isArray(raw) || raw.length === 0) {
        return '[ERROR] instance_ids must be a non-empty array of agent instance IDs';
      }
      ids = raw.map((id: any) => String(id));
    } catch {
      return '[ERROR] instance_ids must be a valid JSON array of strings';
    }

    const timeoutMs = typeof kwargs.timeout_ms === 'number' ? kwargs.timeout_ms : 60_000;

    const collectOne = async (agentId: string) => {
      const completion = await Promise.race([
        deps.manager.waitForCompletion(agentId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);

      if (completion === null) {
        return { agentId, status: 'timeout' as const, result: undefined, error: `Timed out after ${(timeoutMs / 1000).toFixed(0)}s` };
      }
      return { agentId, ...completion };
    };

    const results = await Promise.all(ids.map(collectOne));

    const succeeded = results.filter(r => r.status === 'complete').length;
    const lines: string[] = [
      `[COLLECTED] ${succeeded}/${results.length} succeeded`,
      '',
    ];

    for (const r of results) {
      lines.push(`── ${r.agentId} ──`);
      lines.push(`Status: ${r.status}`);
      if (r.result) lines.push(`Result: ${r.result}`);
      if (r.error) lines.push(`Error: ${r.error}`);
      lines.push('');
    }

    return lines.join('\n');
  };
}
