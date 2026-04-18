import * as vscode from 'vscode';

function parseArgs(raw: unknown): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (Array.isArray(raw)) return { ok: true, value: raw };
  if (typeof raw === 'string') {
    if (raw.trim() === '') return { ok: true, value: [] };
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { ok: true, value: parsed };
      return { ok: true, value: [parsed] };
    } catch {
      return { ok: false, error: 'Argument "args" must be valid JSON (array preferred).' };
    }
  }
  return { ok: true, value: [raw] };
}

function summarizeResult(result: unknown): string {
  if (result === undefined) return '(no result)';
  if (result === null) return 'null';
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }
  try {
    const json = JSON.stringify(result, null, 2);
    if (json === undefined) return `(non-serializable: ${typeof result})`;
    return json.length > 4000 ? json.slice(0, 4000) + '\n… [truncated]' : json;
  } catch {
    return `(non-serializable: ${typeof result})`;
  }
}

export function createVscodeRunHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const command = String(kwargs.command || '').trim();
    if (!command) return '[ERROR] Missing required argument: command';

    const parsed = parseArgs(kwargs.args);
    if (!parsed.ok) return `[ERROR] ${parsed.error}`;

    try {
      const result = await vscode.commands.executeCommand(command, ...parsed.value);
      return `[SUCCESS] Ran "${command}". Result: ${summarizeResult(result)}`;
    } catch (err) {
      return `[ERROR] Command "${command}" failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createVscodeListHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filter = String(kwargs.filter ?? '').trim().toLowerCase();
    const includeInternal = kwargs.include_internal === true;
    const limit = typeof kwargs.limit === 'number' && kwargs.limit > 0 ? Math.floor(kwargs.limit) : 200;

    let commands: string[];
    try {
      commands = await vscode.commands.getCommands(!includeInternal);
    } catch (err) {
      return `[ERROR] Failed to list commands: ${err instanceof Error ? err.message : String(err)}`;
    }

    const filtered = filter
      ? commands.filter((c) => c.toLowerCase().includes(filter))
      : commands;

    filtered.sort();
    const truncated = filtered.length > limit;
    const shown = truncated ? filtered.slice(0, limit) : filtered;

    const header = filter
      ? `${filtered.length} command(s) matching "${filter}"`
      : `${filtered.length} command(s)`;
    const note = truncated ? ` (showing first ${limit})` : '';
    return `${header}${note}:\n${shown.join('\n')}`;
  };
}
