import type { MemoryManager, RecallScope } from '../agent/memory/memory-manager';

/**
 * Deps for hierarchical-memory tools (`memory/add`, `memory/recall`, etc.).
 * `callerId()` must return the agent id whose conversation field should be
 * read/written. Foreground returns 'foreground'.
 */
export interface MemoryToolDeps {
  manager: MemoryManager;
  callerId: () => string;
}

const VALID_SCOPES = new Set(['conversation', 'project', 'global', 'all']);

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export function createMemoryAddHandler(deps: MemoryToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const title = typeof kwargs.title === 'string' ? kwargs.title.trim() : '';
    const body = typeof kwargs.body === 'string' ? kwargs.body.trim() : '';
    if (!title) return '[ERROR] Missing required argument: title. Provide a short label (e.g. "user prefers Python", "API uses OAuth2").';
    if (!body) return '[ERROR] Missing required argument: body. Provide the fact or note to remember (e.g. "The user is a data scientist focused on ML pipelines").';
    const tags = Array.isArray(kwargs.tags)
      ? (kwargs.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : typeof kwargs.tags === 'string'
        ? (kwargs.tags as string).split(',').map(t => t.trim()).filter(Boolean)
        : [];
    const strength = typeof kwargs.strength === 'number' ? Math.max(0, Math.min(1, kwargs.strength)) : 0.7;

    const entry = deps.manager.recordConversationEntry(deps.callerId(), { title, body, tags, strength });
    return `[SUCCESS] Saved to conversation memory. id=${entry.id}`;
  };
}

export function createMemoryRecallHandler(deps: MemoryToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const query = typeof kwargs.query === 'string' ? kwargs.query.trim() : '';
    if (!query) return '[ERROR] Missing required argument: query. Provide a free-text query to search memories (e.g. "user preferences", "project architecture"). Results are ranked by semantic relevance.';
    const scope = (typeof kwargs.scope === 'string' && VALID_SCOPES.has(kwargs.scope))
      ? (kwargs.scope as RecallScope) : 'all';
    const k = typeof kwargs.k === 'number' && kwargs.k > 0 ? Math.min(20, Math.floor(kwargs.k)) : 5;

    const hits = await deps.manager.recall(deps.callerId(), query, scope, k);
    if (hits.length === 0) return `[SUCCESS] No matches for "${truncate(query, 40)}" in scope=${scope}.`;

    const lines = hits.map(h => (
      `• [${h.scope}] ${h.entry.title} (id=${h.entry.id}, score=${h.score.toFixed(3)})\n  ${truncate(h.entry.body, 200)}`
      + (h.entry.tags.length ? `\n  tags: ${h.entry.tags.join(', ')}` : '')
    ));
    return `[SUCCESS] Top ${hits.length} match(es):\n${lines.join('\n')}`;
  };
}

export function createMemoryPromoteHandler(deps: MemoryToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const id = typeof kwargs.id === 'string' ? kwargs.id : '';
    const to = kwargs.to === 'project' || kwargs.to === 'global' ? kwargs.to : null;
    if (!id) return '[ERROR] Missing required argument: id. Use the entry id from memory/recall or memory/list.';
    if (!to) return '[ERROR] Missing required argument: to. Must be "project" (persists across conversations in this workspace) or "global" (persists across all workspaces).';

    const promoted = deps.manager.promote(deps.callerId(), id, to);
    if (!promoted) return `[ERROR] No entry found with id=${id} in any scope reachable from this agent.`;
    return `[SUCCESS] Promoted to ${to}. newId=${promoted.id}`;
  };
}

export function createMemoryListHandler(deps: MemoryToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const scope = kwargs.scope === 'project' || kwargs.scope === 'global' ? kwargs.scope : 'conversation';
    const k = typeof kwargs.k === 'number' && kwargs.k > 0 ? Math.min(100, Math.floor(kwargs.k)) : 20;
    const entries = deps.manager.list(deps.callerId(), scope, k);
    if (entries.length === 0) return `[SUCCESS] No entries in scope=${scope}.`;

    const lines = entries.map(e => (
      `• ${e.title} (id=${e.id}, strength=${e.strength.toFixed(2)}, access=${e.accessCount})\n  ${truncate(e.body, 160)}`
    ));
    return `[SUCCESS] ${entries.length} entries in ${scope}:\n${lines.join('\n')}`;
  };
}

export function createMemoryForgetHandler(deps: MemoryToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const id = typeof kwargs.id === 'string' ? kwargs.id : '';
    if (!id) return '[ERROR] Missing required argument: id';
    const ok = deps.manager.remove(deps.callerId(), id);
    return ok ? `[SUCCESS] Removed id=${id}.` : `[ERROR] No entry with id=${id}.`;
  };
}
