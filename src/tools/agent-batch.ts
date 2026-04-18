import type { AgentToolDeps } from './agent-deps';
import type { CompletionResult } from '../agent/agent-manager';
import { logger } from '../shared/logger';

interface BatchTask {
  task: string;
  label?: string;
  model?: string;
  provider?: string;
}

function formatResults(
  results: Array<{ label: string; agentId: string; completion: CompletionResult }>,
): string {
  const succeeded = results.filter(r => r.completion.status === 'complete').length;
  const lines: string[] = [
    `[BATCH COMPLETE] ${succeeded}/${results.length} succeeded`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`── Task ${i + 1}: "${r.label}" (${r.agentId}) ──`);
    lines.push(`Status: ${r.completion.status}`);
    if (r.completion.result) {
      lines.push(`Result: ${r.completion.result}`);
    }
    if (r.completion.error) {
      lines.push(`Error: ${r.completion.error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function createAgentBatchHandler(deps: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    let tasks: BatchTask[];
    try {
      const raw = typeof kwargs.tasks === 'string' ? JSON.parse(kwargs.tasks) : kwargs.tasks;
      if (!Array.isArray(raw) || raw.length === 0) {
        return '[ERROR] tasks must be a non-empty array of {task, label?, model?, provider?} objects';
      }
      tasks = raw.map((t: any) => ({
        task: String(t.task || ''),
        label: t.label ? String(t.label) : undefined,
        model: t.model ? String(t.model) : undefined,
        provider: t.provider ? String(t.provider) : undefined,
      }));
      for (const t of tasks) {
        if (!t.task.trim()) return '[ERROR] Each task must have a non-empty "task" string';
      }
    } catch {
      return '[ERROR] tasks must be a valid JSON array';
    }

    const mode = String(kwargs.execution_mode || 'parallel');
    if (mode !== 'parallel' && mode !== 'sequential') {
      return '[ERROR] execution_mode must be "parallel" or "sequential"';
    }

    const budgetUsd = typeof kwargs.budget_usd === 'number' ? kwargs.budget_usd : undefined;
    const timeoutMs = typeof kwargs.timeout_ms === 'number' ? kwargs.timeout_ms : undefined;
    const callerId = deps.callerId();
    const batchId = `batch-${Date.now().toString(36)}`;

    if (mode === 'parallel') {
      // Spawn all agents at once
      const spawned: Array<{ label: string; agentId: string }> = [];

      for (const t of tasks) {
        const result = await deps.manager.spawn({
          task: t.task,
          label: t.label,
          model: t.provider || t.model ? { provider: t.provider, name: t.model } : undefined,
          budgetUsd,
          timeoutMs,
          parentId: callerId === 'foreground' ? undefined : callerId,
          batchId,
        });

        if (!result.ok) {
          return `[ERROR] Failed to spawn task "${t.label || t.task.slice(0, 40)}": ${result.error}`;
        }
        spawned.push({ label: t.label || t.task.slice(0, 40), agentId: result.agentId });
      }

      // Await all
      const completions = await Promise.all(
        spawned.map(async (s) => {
          const completion = await deps.manager.waitForCompletion(s.agentId);
          return { ...s, completion };
        }),
      );

      return formatResults(completions);
    } else {
      // Sequential: spawn one at a time, wait for completion
      const results: Array<{ label: string; agentId: string; completion: CompletionResult }> = [];

      for (const t of tasks) {
        const label = t.label || t.task.slice(0, 40);
        const result = await deps.manager.spawn({
          task: t.task,
          label: t.label,
          model: t.provider || t.model ? { provider: t.provider, name: t.model } : undefined,
          budgetUsd,
          timeoutMs,
          parentId: callerId === 'foreground' ? undefined : callerId,
          batchId,
        });

        if (!result.ok) {
          results.push({
            label,
            agentId: 'N/A',
            completion: { status: 'error', error: result.error },
          });
          continue;
        }

        const completion = await deps.manager.waitForCompletion(result.agentId);
        results.push({ label, agentId: result.agentId, completion });

        // Stop on first failure in sequential mode
        if (completion.status !== 'complete') {
          logger.info(`Batch sequential: stopping after failure at task "${label}"`);
          break;
        }
      }

      return formatResults(results);
    }
  };
}
