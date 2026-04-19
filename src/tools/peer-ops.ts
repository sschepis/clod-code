import type { PeerManager, PeerSnapshot } from '../peers/peer-manager';
import { currentWindowId, getPresenceDirPath, listPresenceFilesRaw } from '../shared/window-id';

export interface PeerToolDeps {
  manager: PeerManager;
  /** Send a message from one agent to another in the same window.
   *  Returns the target agent's response text (sync) or a confirmation (async). */
  sendMessageToAgent?: (
    callerAgentId: string,
    targetAgentId: string,
    message: string,
    awaitResponse: boolean,
  ) => Promise<string>;
  /** The agent ID that owns this tool instance. */
  callerAgentId?: string;
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
    const localAgents = deps.manager.listLocalAgents();
    const selfId = currentWindowId();
    const lines: string[] = [];

    // Always show this window's agents first
    lines.push(`This window: ${selfId.slice(0, 8)} (pid=${process.pid})`);
    if (localAgents.length === 0) {
      lines.push(`  (no agents)`);
    } else {
      const running = localAgents.filter((a) => a.status === 'running').length;
      lines.push(`  ${localAgents.length} agent${localAgents.length === 1 ? '' : 's'} (${running} running):`);
      for (const a of localAgents) {
        const label = a.id === 'foreground' ? 'foreground' : a.id;
        lines.push(`    ${label}  [${a.status}]  ${a.label}`);
      }
    }

    // Then show cross-window peers
    if (peers.length > 0) {
      lines.push(``);
      lines.push(`${peers.length} peer window${peers.length === 1 ? '' : 's'}:`);
      for (const p of peers) {
        const running = p.agents.filter((a) => a.status === 'running').length;
        lines.push(
          `  ${p.windowId.slice(0, 8)}  pid=${p.pid}  port=${p.coordPort}  up=${ageString(p.startedAt)}  agents=${p.agents.length} (${running} running)`,
        );
        for (const a of p.agents) {
          const label = a.id === 'foreground' ? 'foreground' : a.id;
          lines.push(`    ${label}  [${a.status}]  ${a.label}`);
        }
      }
    } else {
      lines.push(``);
      lines.push(`No peer windows. To coordinate across windows, open this same`);
      lines.push(`workspace folder in another VS Code window.`);
    }

    return lines.join('\n');
  };
}

export function createPeerDebugHandler(deps: PeerToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const state = deps.manager.debugState();
    const lines: string[] = [
      `=== Peer Discovery Debug ===`,
      ``,
      `Self: ${state.selfId.slice(0, 8)} (full: ${state.selfId})`,
      `Server port: ${state.serverPort}`,
      `Presence dir: ${state.presenceDir ?? '(null)'}`,
      ``,
      `--- Presence Files (raw) ---`,
    ];
    if (state.presenceFiles.length === 0) {
      lines.push(`  (none)`);
    }
    for (const f of state.presenceFiles) {
      const isSelf = f.content?.windowId === state.selfId;
      if (f.content) {
        lines.push(
          `  ${f.filename}${isSelf ? ' (SELF)' : ''}:` +
          ` windowId=${f.content.windowId.slice(0, 8)}` +
          ` pid=${f.content.pid}` +
          ` coordPort=${f.content.coordPort ?? 'NONE'}` +
          ` alive=${f.alive}` +
          ` age=${ageString(f.content.createdAt)}`
        );
      } else {
        lines.push(`  ${f.filename}: ERROR: ${f.error}`);
      }
    }
    lines.push(``);
    lines.push(`--- Active Windows (after filtering) ---`);
    if (state.activeWindows.length === 0) {
      lines.push(`  (none)`);
    }
    for (const w of state.activeWindows) {
      const isSelf = w.windowId === state.selfId;
      lines.push(
        `  ${w.windowId.slice(0, 8)}${isSelf ? ' (SELF)' : ''}:` +
        ` pid=${w.pid}` +
        ` coordPort=${w.coordPort ?? 'NONE'}` +
        ` age=${ageString(w.createdAt)}`
      );
    }
    lines.push(``);
    lines.push(`--- SSE Client Connections ---`);
    lines.push(`  Total: ${state.clientCount}`);
    if (state.clients.length === 0) {
      lines.push(`  (none)`);
    }
    for (const c of state.clients) {
      lines.push(
        `  ${c.windowId.slice(0, 8)}:` +
        ` pid=${c.pid}` +
        ` port=${c.coordPort}` +
        ` lastSeen=${ageString(Date.now() - c.lastSeenAgo)} ago` +
        ` stale=${c.stale}` +
        ` agents=${c.agentCount}` +
        ` backoff=${c.backoffMs}ms`
      );
    }
    lines.push(``);
    lines.push(`--- Peers (visible to peer/list) ---`);
    if (state.peers.length === 0) {
      lines.push(`  (none — peers must have coordPort, be non-self, and lastSeen < 45s)`);
    }
    for (const p of state.peers) {
      lines.push(
        `  ${p.windowId.slice(0, 8)}:` +
        ` pid=${p.pid}` +
        ` port=${p.coordPort}` +
        ` agents=${p.agents.length}` +
        ` lastSeen=${ageString(p.lastSeen)} ago`
      );
    }
    return lines.join('\n');
  };
}

export function createPeerSendHandler(deps: PeerToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const targetId = String(kwargs.target_agent_id || '').trim();
    const message = typeof kwargs.message === 'string' ? kwargs.message.trim() : '';
    const asyncMode = kwargs.async === true || kwargs.async === 'true';
    if (!targetId) return '[ERROR] Missing required argument: target_agent_id';
    if (!message) return '[ERROR] Missing required argument: message';

    if (!deps.sendMessageToAgent) {
      return '[ERROR] Inter-agent messaging is not available.';
    }

    const callerId = deps.callerAgentId ?? 'unknown';

    // Resolve target: accept full id or prefix match against local agents
    const locals = deps.manager.listLocalAgents();
    const target = locals.find(
      (a) => a.id === targetId || a.id.startsWith(targetId),
    );
    if (!target) {
      const available = locals.map((a) => `  ${a.id}  [${a.status}]  ${a.label}`).join('\n');
      return `[ERROR] No agent matching "${targetId}" in this window.\nAvailable agents:\n${available}`;
    }
    if (target.id === callerId) {
      return '[ERROR] Cannot send a message to yourself.';
    }

    try {
      const response = await deps.sendMessageToAgent(
        callerId,
        target.id,
        message,
        !asyncMode,
      );
      return response;
    } catch (err) {
      return `[ERROR] Failed to send message: ${err instanceof Error ? err.message : String(err)}`;
    }
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
