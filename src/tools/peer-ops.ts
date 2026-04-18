import type { PeerManager, PeerSnapshot } from '../peers/peer-manager';
import { currentWindowId } from '../shared/window-id';

export interface PeerToolDeps {
  manager: PeerManager;
}

function resolvePeer(mgr: PeerManager, peerId: string): PeerSnapshot | null {
  const peers = mgr.listPeers();
  // Accept full or prefixed (>= 4 chars) windowId.
  const trimmed = peerId.trim();
  if (!trimmed) return null;
  if (trimmed.length >= 4) {
    const match = peers.find((p) => p.windowId === trimmed || p.windowId.startsWith(trimmed));
    if (match) return match;
  }
  return null;
}

function ageString(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

export function createPeerListHandler(deps: PeerToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const peers = deps.manager.listPeers();
    const selfId = currentWindowId();
    if (peers.length === 0) {
      return `No peer Clodcode windows on this workspace.\nThis window: ${selfId.slice(0, 8)}.`;
    }
    const lines: string[] = [
      `This window: ${selfId.slice(0, 8)}`,
      `${peers.length} peer window${peers.length === 1 ? '' : 's'}:`,
    ];
    for (const p of peers) {
      const running = p.agents.filter((a) => a.status === 'running').length;
      lines.push(
        `  ${p.windowId.slice(0, 8)}  pid=${p.pid}  port=${p.coordPort}  up=${ageString(p.startedAt)}  agents=${p.agents.length} (${running} running)`,
      );
      for (const a of p.agents) {
        const label = a.id === 'foreground' ? 'foreground' : a.id.slice(0, 10);
        lines.push(`    └ ${label}  [${a.status}]  ${a.label}`);
      }
    }
    return lines.join('\n');
  };
}

export function createPeerDispatchHandler(deps: PeerToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const peerId = String(kwargs.peer_id || '').trim();
    const task = typeof kwargs.task === 'string' ? kwargs.task.trim() : '';
    const label = typeof kwargs.label === 'string' ? kwargs.label.trim() : undefined;
    if (!peerId) return '[ERROR] Missing required argument: peer_id';
    if (!task) return '[ERROR] Missing required argument: task';

    const peer = resolvePeer(deps.manager, peerId);
    if (!peer) {
      return `[ERROR] No peer window matching "${peerId}". Use peer/list to see available peers.`;
    }
    try {
      const rpcId = await deps.manager.sendDispatch(peer.windowId, task, label);
      return [
        `[SUCCESS] Dispatch sent to peer ${peer.windowId.slice(0, 8)} (port ${peer.coordPort}).`,
        `The peer's user must approve the request before the agent will spawn.`,
        `rpc_id: ${rpcId}`,
        `Poll with: peer/status peer_id="${peer.windowId.slice(0, 8)}" rpc_id="${rpcId}"`,
      ].join('\n');
    } catch (err) {
      return `[ERROR] Dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createPeerAskHandler(deps: PeerToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const peerId = String(kwargs.peer_id || '').trim();
    const question = typeof kwargs.question === 'string' ? kwargs.question.trim() : '';
    const rawChoices = kwargs.choices;
    const rawDefault = kwargs.default;
    const rawMode = typeof kwargs.mode === 'string' ? kwargs.mode.trim().toLowerCase() : '';
    if (!peerId) return '[ERROR] Missing required argument: peer_id';
    if (!question) return '[ERROR] Missing required argument: question';

    let choices: string[] = [];
    if (Array.isArray(rawChoices)) {
      choices = rawChoices.map((c) => String(c));
    } else if (typeof rawChoices === 'string' && rawChoices.trim()) {
      try {
        const parsed = JSON.parse(rawChoices);
        if (Array.isArray(parsed)) choices = parsed.map((c) => String(c));
      } catch {
        return '[ERROR] "choices" must be a JSON array of strings.';
      }
    }

    // Infer mode: explicit `mode` wins; else if 0/1 choices → text; else choice.
    const inputMode: 'choice' | 'text' =
      rawMode === 'text' ? 'text'
        : rawMode === 'choice' ? 'choice'
        : choices.length < 2 ? 'text'
        : 'choice';

    if (inputMode === 'choice' && choices.length < 2) {
      return '[ERROR] "choices" must contain at least 2 options, or set mode="text".';
    }

    const defaultChoice =
      typeof rawDefault === 'number' && rawDefault >= 0 && rawDefault < choices.length
        ? rawDefault
        : undefined;

    const peer = resolvePeer(deps.manager, peerId);
    if (!peer) return `[ERROR] No peer window matching "${peerId}".`;

    let rpcId: string;
    try {
      rpcId = await deps.manager.sendAsk(
        peer.windowId,
        question,
        inputMode === 'choice' ? choices : [],
        defaultChoice,
        inputMode,
      );
    } catch (err) {
      return `[ERROR] Peer ask failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Prefer SSE-driven wait; fall back to the final-poll behaviour of
    // awaitAskAnswer when the peer's socket has a hiccup.
    try {
      const status = await deps.manager.awaitAskAnswer(peer.windowId, rpcId, 90_000);
      if (!status) return `[ERROR] Peer forgot rpc_id "${rpcId}".`;
      if (status.status === 'answered') {
        const indexSuffix = typeof status.answerIndex === 'number' ? ` (index ${status.answerIndex})` : '';
        return `User on peer ${peer.windowId.slice(0, 8)} answered: "${status.answerText}"${indexSuffix}.`;
      }
      if (status.status === 'cancelled') return '[USER CANCELLED] Peer user dismissed the question.';
      if (status.status === 'rejected') return `[ERROR] Peer rejected the ask: ${status.reason ?? 'no reason'}`;
      // Timed out waiting — tell the caller how to keep polling.
      return [
        `Peer ask pending after 90s (user on ${peer.windowId.slice(0, 8)} hasn't answered yet).`,
        `rpc_id: ${rpcId}`,
        `Keep polling with: peer/ask-status peer_id="${peer.windowId.slice(0, 8)}" rpc_id="${rpcId}"`,
      ].join('\n');
    } catch (err) {
      return `[ERROR] Peer ask wait failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createPeerAskStatusHandler(deps: PeerToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const peerId = String(kwargs.peer_id || '').trim();
    const rpcId = String(kwargs.rpc_id || '').trim();
    if (!peerId) return '[ERROR] Missing required argument: peer_id';
    if (!rpcId) return '[ERROR] Missing required argument: rpc_id';
    const peer = resolvePeer(deps.manager, peerId);
    if (!peer) return `[ERROR] No peer window matching "${peerId}".`;
    try {
      const status = await deps.manager.queryAskStatus(peer.windowId, rpcId);
      if (!status) return `[ERROR] No peer-ask with rpc_id "${rpcId}".`;
      const lines: string[] = [`status: ${status.status}`];
      if (status.answerText !== undefined) {
        lines.push(`answer: "${status.answerText}" (index ${status.answerIndex})`);
      }
      if (status.reason) lines.push(`reason: ${status.reason}`);
      if (status.completedAt) {
        lines.push(`completed: ${new Date(status.completedAt).toISOString()}`);
      }
      return lines.join('\n');
    } catch (err) {
      return `[ERROR] Peer ask status failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createPeerCancelHandler(deps: PeerToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const peerId = String(kwargs.peer_id || '').trim();
    const rpcId = String(kwargs.rpc_id || '').trim();
    if (!peerId) return '[ERROR] Missing required argument: peer_id';
    if (!rpcId) return '[ERROR] Missing required argument: rpc_id';
    const peer = resolvePeer(deps.manager, peerId);
    if (!peer) return `[ERROR] No peer window matching "${peerId}".`;
    try {
      const result = await deps.manager.sendCancel(peer.windowId, rpcId);
      if (!result.ok) return `[ERROR] Peer cancel refused: ${result.reason ?? 'unknown'}`;
      return `[SUCCESS] Cancellation sent to peer ${peer.windowId.slice(0, 8)} for rpc_id ${rpcId}.`;
    } catch (err) {
      return `[ERROR] Peer cancel failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createPeerStatusHandler(deps: PeerToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const peerId = String(kwargs.peer_id || '').trim();
    const rpcId = String(kwargs.rpc_id || '').trim();
    if (!peerId) return '[ERROR] Missing required argument: peer_id';
    if (!rpcId) return '[ERROR] Missing required argument: rpc_id';

    const peer = resolvePeer(deps.manager, peerId);
    if (!peer) return `[ERROR] No peer window matching "${peerId}".`;
    try {
      const status = await deps.manager.queryDispatchStatus(peer.windowId, rpcId);
      if (!status) {
        return `[ERROR] No dispatch with rpc_id "${rpcId}" on peer ${peer.windowId.slice(0, 8)} (may have been garbage-collected).`;
      }
      const lines: string[] = [`status: ${status.status}`];
      if (status.reason) lines.push(`reason: ${status.reason}`);
      if (status.error) lines.push(`error: ${status.error}`);
      if (typeof status.cost?.totalCost === 'number') {
        lines.push(`cost: $${status.cost.totalCost.toFixed(4)} (${status.cost.totalTokens} tokens)`);
      }
      if (status.completedAt) {
        lines.push(`completed: ${new Date(status.completedAt).toISOString()}`);
      }
      if (status.result) lines.push('', 'result:', status.result);
      return lines.join('\n');
    } catch (err) {
      return `[ERROR] Status query failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
