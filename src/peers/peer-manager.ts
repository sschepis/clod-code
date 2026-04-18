import * as http from 'http';
import { logger } from '../shared/logger';
import type { AgentSummary } from '../shared/message-types';
import {
  currentWindowId,
  listActiveWindows,
  updateWindowPresence,
  type WindowPresence,
} from '../shared/window-id';
import {
  PeerServer,
  type PeerEvent,
  type DispatchRequestBody,
  type DispatchResponseBody,
  type DispatchStatusBody,
  type AskRequestBody,
  type AskResponseBody,
  type AskStatusBody,
  type CancelRequestBody,
  type CancelResponseBody,
} from './peer-server';
import { PeerClient } from './peer-client';

const DISCOVERY_INTERVAL_MS = 5_000;
const PEER_STALE_MS = 45_000;   // heartbeat is 15s → 3 missed = dead

export interface PeerSnapshot {
  windowId: string;
  pid: number;
  coordPort: number;
  startedAt: number;
  lastSeen: number;
  agents: AgentSummary[];
}

interface ClientRecord {
  info: WindowPresence;
  client: PeerClient;
  snapshot: PeerSnapshot;
  backoffMs: number;
  retryTimer?: NodeJS.Timeout;
}

export interface OutboundDispatch {
  rpcId: string;
  peerWindowId: string;
  task: string;
  label: string;
  /** Mirrors the dispatch status values from the receiver. */
  status: 'pending_approval' | 'running' | 'completed' | 'error' | 'rejected' | 'cancelled';
  sentAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  reason?: string;
}

export interface PeerManagerOptions {
  /** Called whenever the set of peers or their agents changes. */
  onPeersChanged?: (peers: PeerSnapshot[]) => void;
  /** Invoked when a peer calls POST /dispatch on this window. Returns the
   *  newly-created rpcId (or null to reject). */
  onDispatchReceived?: (req: DispatchRequestBody) => DispatchResponseBody | null;
  /** Called by the PeerServer's GET /dispatch-status endpoint. */
  getDispatchStatus?: (rpcId: string) => DispatchStatusBody | null;
  onAskReceived?: (req: AskRequestBody) => AskResponseBody | null;
  getAskStatus?: (rpcId: string) => AskStatusBody | null;
  onCancelReceived?: (req: CancelRequestBody) => CancelResponseBody;
  /** Called when outbound dispatches are added or mutated. */
  onOutboundChanged?: (outbound: OutboundDispatch[]) => void;
}

interface AskWaiter {
  peerWindowId: string;
  resolve: (status: AskStatusBody | null) => void;
  timer: NodeJS.Timeout;
}

interface DispatchWaiter {
  peerWindowId: string;
  resolve: (status: DispatchStatusBody | null) => void;
  timer: NodeJS.Timeout;
}

export class PeerManager {
  private readonly server: PeerServer;
  private readonly clients = new Map<string, ClientRecord>();
  private discoveryTimer?: NodeJS.Timeout;
  private stopping = false;
  private readonly onPeersChanged?: (peers: PeerSnapshot[]) => void;
  private readonly askWaiters = new Map<string, AskWaiter>();
  private readonly dispatchWaiters = new Map<string, DispatchWaiter>();
  private readonly outbound = new Map<string, OutboundDispatch>();
  private readonly onOutboundChanged?: (outbound: OutboundDispatch[]) => void;
  private readonly outboundRetentionMs = 30_000;

  constructor(
    private readonly getLocalAgents: () => AgentSummary[],
    opts: PeerManagerOptions = {},
  ) {
    this.onPeersChanged = opts.onPeersChanged;
    this.onOutboundChanged = opts.onOutboundChanged;
    this.server = new PeerServer({
      windowId: currentWindowId(),
      getAgents: this.getLocalAgents,
      onDispatchReceived: opts.onDispatchReceived,
      getDispatchStatus: opts.getDispatchStatus,
      onAskReceived: opts.onAskReceived,
      getAskStatus: opts.getAskStatus,
      onCancelReceived: opts.onCancelReceived,
    });
  }

  private emit(): void {
    try { this.onPeersChanged?.(this.listPeers()); } catch { /* best-effort */ }
  }

  /** Current outbound dispatch list (includes recently-completed ones). */
  listOutbound(): OutboundDispatch[] {
    return [...this.outbound.values()].sort((a, b) => a.sentAt - b.sentAt);
  }

  private emitOutbound(): void {
    try { this.onOutboundChanged?.(this.listOutbound()); } catch { /* best-effort */ }
  }

  private upsertOutbound(rec: OutboundDispatch): void {
    this.outbound.set(rec.rpcId, rec);
    this.emitOutbound();
    if (rec.completedAt) {
      setTimeout(() => {
        this.outbound.delete(rec.rpcId);
        this.emitOutbound();
      }, this.outboundRetentionMs);
    }
  }

  async start(): Promise<void> {
    const port = await this.server.start();
    updateWindowPresence({ coordPort: port });
    this.discoveryTimer = setInterval(() => this.discover(), DISCOVERY_INTERVAL_MS);
    // Kick off an immediate discovery so peers show up without the 5s wait.
    this.discover();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = undefined;
    for (const [, rec] of this.clients) {
      if (rec.retryTimer) clearTimeout(rec.retryTimer);
      rec.client.abort();
    }
    this.clients.clear();
    await this.server.stop();
  }

  /** Call whenever this window's agent summaries change. */
  notifyLocalAgentsChanged(): void {
    this.server.notifyAgentsChanged();
  }

  /** Orchestrator calls these when a peer-ask or dispatch becomes terminal
   *  so the originating peer gets the answer immediately via SSE. */
  notifyAskResolved(payload: {
    rpcId: string;
    status: string;
    answerIndex?: number;
    answerText?: string;
    reason?: string;
  }): void {
    this.server.notifyAskResolved(payload);
  }

  notifyDispatchResolved(payload: {
    rpcId: string;
    status: string;
    result?: string;
    error?: string;
    reason?: string;
    completedAt?: number;
  }): void {
    this.server.notifyDispatchResolved(payload);
  }

  /** Send a dispatch to a peer. Resolves with the peer's `rpcId` or rejects. */
  async sendDispatch(peerWindowId: string, task: string, label?: string): Promise<string> {
    const rec = this.clients.get(peerWindowId);
    if (!rec) throw new Error(`Peer "${peerWindowId}" not connected.`);
    const port = rec.snapshot.coordPort;
    const body = JSON.stringify({
      fromWindowId: currentWindowId(),
      task,
      label,
    });
    const res = await this.postJson(port, '/dispatch', body);
    if (res.statusCode !== 200) {
      throw new Error(`peer dispatch failed (status ${res.statusCode}): ${res.body}`);
    }
    let parsed: { rpcId?: unknown };
    try {
      parsed = JSON.parse(res.body);
    } catch (err) {
      throw new Error(`peer dispatch response parse: ${err instanceof Error ? err.message : err}`);
    }
    if (!parsed || typeof parsed.rpcId !== 'string') {
      throw new Error('peer response missing rpcId');
    }

    this.upsertOutbound({
      rpcId: parsed.rpcId,
      peerWindowId,
      task,
      label: (label ?? task).trim().slice(0, 60) || 'Peer task',
      status: 'pending_approval',
      sentAt: Date.now(),
    });

    return parsed.rpcId;
  }

  /** Poll a peer's dispatch status. Returns null if the peer 404s. */
  async queryDispatchStatus(peerWindowId: string, rpcId: string): Promise<DispatchStatusBody | null> {
    const rec = this.clients.get(peerWindowId);
    if (!rec) throw new Error(`Peer "${peerWindowId}" not connected.`);
    const port = rec.snapshot.coordPort;
    const res = await this.getJson(port, `/dispatch-status?rpcId=${encodeURIComponent(rpcId)}`);
    if (res.statusCode === 404) return null;
    if (res.statusCode !== 200) {
      throw new Error(`peer status failed (status ${res.statusCode}): ${res.body}`);
    }
    return JSON.parse(res.body) as DispatchStatusBody;
  }

  /** Ask a question of a peer's user. Returns rpcId; poll queryAskStatus or
   *  use awaitAskAnswer for SSE-driven waiting. */
  async sendAsk(
    peerWindowId: string,
    question: string,
    choices: string[],
    defaultChoice?: number,
    inputMode: 'choice' | 'text' = 'choice',
  ): Promise<string> {
    const rec = this.clients.get(peerWindowId);
    if (!rec) throw new Error(`Peer "${peerWindowId}" not connected.`);
    const port = rec.snapshot.coordPort;
    const body = JSON.stringify({
      fromWindowId: currentWindowId(),
      question,
      choices,
      defaultChoice,
      inputMode,
    });
    const res = await this.postJson(port, '/ask', body);
    if (res.statusCode !== 200) {
      throw new Error(`peer ask failed (status ${res.statusCode}): ${res.body}`);
    }
    const parsed = JSON.parse(res.body);
    if (typeof parsed?.rpcId !== 'string') throw new Error('peer ask response missing rpcId');
    return parsed.rpcId;
  }

  /**
   * Wait for a peer-ask to become terminal, returning the final status.
   * Prefers the SSE `ask_resolved` event; on timeout, does one final poll
   * of `GET /ask-status` to pick up any answer the SSE missed. A null
   * return means the peer forgot the rpcId (e.g. GC'd).
   */
  awaitAskAnswer(
    peerWindowId: string,
    rpcId: string,
    timeoutMs = 90_000,
  ): Promise<AskStatusBody | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        this.askWaiters.delete(rpcId);
        try {
          const status = await this.queryAskStatus(peerWindowId, rpcId);
          resolve(status);
        } catch {
          resolve(null);
        }
      }, timeoutMs);
      this.askWaiters.set(rpcId, {
        peerWindowId,
        resolve: (s) => {
          clearTimeout(timer);
          this.askWaiters.delete(rpcId);
          resolve(s);
        },
        timer,
      });
    });
  }

  awaitDispatchCompletion(
    peerWindowId: string,
    rpcId: string,
    timeoutMs: number,
  ): Promise<DispatchStatusBody | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        this.dispatchWaiters.delete(rpcId);
        try {
          const status = await this.queryDispatchStatus(peerWindowId, rpcId);
          resolve(status);
        } catch {
          resolve(null);
        }
      }, timeoutMs);
      this.dispatchWaiters.set(rpcId, {
        peerWindowId,
        resolve: (s) => {
          clearTimeout(timer);
          this.dispatchWaiters.delete(rpcId);
          resolve(s);
        },
        timer,
      });
    });
  }

  async queryAskStatus(peerWindowId: string, rpcId: string): Promise<AskStatusBody | null> {
    const rec = this.clients.get(peerWindowId);
    if (!rec) throw new Error(`Peer "${peerWindowId}" not connected.`);
    const port = rec.snapshot.coordPort;
    const res = await this.getJson(port, `/ask-status?rpcId=${encodeURIComponent(rpcId)}`);
    if (res.statusCode === 404) return null;
    if (res.statusCode !== 200) {
      throw new Error(`peer ask status failed (status ${res.statusCode}): ${res.body}`);
    }
    return JSON.parse(res.body) as AskStatusBody;
  }

  /** Ask the peer to cancel an in-flight dispatch. Only the originating peer
   *  is allowed to cancel (enforced on the receiver side via fromWindowId). */
  async sendCancel(peerWindowId: string, rpcId: string): Promise<CancelResponseBody> {
    const rec = this.clients.get(peerWindowId);
    if (!rec) throw new Error(`Peer "${peerWindowId}" not connected.`);
    const port = rec.snapshot.coordPort;
    const body = JSON.stringify({ fromWindowId: currentWindowId(), rpcId });
    const res = await this.postJson(port, '/cancel', body);
    try {
      return JSON.parse(res.body) as CancelResponseBody;
    } catch {
      return { ok: false, reason: `peer cancel non-JSON response (status ${res.statusCode})` };
    }
  }

  /** Snapshot of all live peer windows (excluding self). */
  listPeers(): PeerSnapshot[] {
    const now = Date.now();
    const fresh: PeerSnapshot[] = [];
    for (const [id, rec] of this.clients) {
      if (now - rec.snapshot.lastSeen > PEER_STALE_MS) continue;
      if (id === currentWindowId()) continue;
      fresh.push({ ...rec.snapshot, agents: [...rec.snapshot.agents] });
    }
    return fresh.sort((a, b) => a.startedAt - b.startedAt);
  }

  // ── Discovery ──────────────────────────────────────────────────────

  private discover(): void {
    const meId = currentWindowId();
    const alive = listActiveWindows().filter((w) => w.windowId !== meId && w.coordPort);

    const aliveIds = new Set(alive.map((w) => w.windowId));

    // Connect to any peers we don't already have a client for.
    for (const info of alive) {
      if (this.clients.has(info.windowId)) continue;
      this.connect(info);
    }

    // Drop clients for peers that are no longer registered.
    let changed = false;
    for (const id of [...this.clients.keys()]) {
      if (!aliveIds.has(id)) {
        const rec = this.clients.get(id)!;
        if (rec.retryTimer) clearTimeout(rec.retryTimer);
        rec.client.abort();
        this.clients.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private connect(info: WindowPresence): void {
    if (!info.coordPort || this.stopping) return;
    const snapshot: PeerSnapshot = {
      windowId: info.windowId,
      pid: info.pid,
      coordPort: info.coordPort,
      startedAt: info.createdAt,
      lastSeen: Date.now(),
      agents: [],
    };
    const rec: ClientRecord = {
      info,
      client: null as unknown as PeerClient,
      snapshot,
      backoffMs: 500,
    };
    rec.client = new PeerClient({
      port: info.coordPort,
      onEvent: (e) => this.onPeerEvent(rec, e),
      onClose: (err) => this.onPeerClose(rec, err),
    });
    this.clients.set(info.windowId, rec);

    // Fetch one-shot /info so we have agents before the first SSE event arrives.
    this.fetchInfoOnce(info).then((agents) => {
      if (agents && this.clients.get(info.windowId) === rec) {
        rec.snapshot.agents = agents;
        rec.snapshot.lastSeen = Date.now();
      }
    }).catch(() => { /* ignore — SSE will populate */ });

    rec.client.start();
    this.emit();
  }

  private onPeerEvent(rec: ClientRecord, event: PeerEvent): void {
    rec.snapshot.lastSeen = Date.now();
    rec.backoffMs = 500;
    let changed = false;
    switch (event.type) {
      case 'hello':
      case 'agents_changed':
        if (Array.isArray(event.agents)) {
          rec.snapshot.agents = event.agents;
          changed = true;
        }
        break;
      case 'heartbeat':
        break;
      case 'goodbye':
        rec.client.abort();
        this.clients.delete(rec.info.windowId);
        changed = true;
        break;
      case 'ask_resolved':
        if (event.askResolved) {
          const waiter = this.askWaiters.get(event.askResolved.rpcId);
          if (waiter && waiter.peerWindowId === rec.info.windowId) {
            waiter.resolve({
              status: event.askResolved.status,
              answerIndex: event.askResolved.answerIndex,
              answerText: event.askResolved.answerText,
              reason: event.askResolved.reason,
            });
          }
        }
        break;
      case 'dispatch_resolved':
        if (event.dispatchResolved) {
          const resolved = event.dispatchResolved;
          const isTerminal =
            resolved.status === 'completed' || resolved.status === 'error' ||
            resolved.status === 'rejected' || resolved.status === 'cancelled';
          // Only wake the awaitDispatchCompletion waiter on terminal states.
          const waiter = this.dispatchWaiters.get(resolved.rpcId);
          if (waiter && waiter.peerWindowId === rec.info.windowId && isTerminal) {
            waiter.resolve({
              status: resolved.status,
              result: resolved.result,
              error: resolved.error,
              reason: resolved.reason,
              completedAt: resolved.completedAt,
            });
          }
          // Mirror any state change onto the outbound registry so the UI
          // reflects approval (pending_approval → running) as well as
          // completion.
          const outRec = this.outbound.get(resolved.rpcId);
          if (outRec && outRec.peerWindowId === rec.info.windowId) {
            this.upsertOutbound({
              ...outRec,
              status: resolved.status as OutboundDispatch['status'],
              result: resolved.result ?? outRec.result,
              error: resolved.error ?? outRec.error,
              reason: resolved.reason ?? outRec.reason,
              completedAt: isTerminal ? (resolved.completedAt ?? Date.now()) : outRec.completedAt,
            });
          }
        }
        break;
    }
    if (changed) this.emit();
  }

  private onPeerClose(rec: ClientRecord, err?: Error): void {
    if (this.stopping) return;
    if (err) logger.info(`[peers] connection to ${rec.info.windowId} closed: ${err.message}`);
    // Try to reconnect with backoff — the peer may just be briefly unavailable.
    if (rec.retryTimer) clearTimeout(rec.retryTimer);
    rec.retryTimer = setTimeout(() => {
      if (this.stopping) return;
      // Only reconnect if the peer is still in the presence directory.
      const still = listActiveWindows().find((w) => w.windowId === rec.info.windowId);
      if (!still) {
        this.clients.delete(rec.info.windowId);
        return;
      }
      rec.info = still;
      rec.snapshot.coordPort = still.coordPort ?? rec.snapshot.coordPort;
      rec.client = new PeerClient({
        port: rec.snapshot.coordPort,
        onEvent: (e) => this.onPeerEvent(rec, e),
        onClose: (e) => this.onPeerClose(rec, e),
      });
      rec.backoffMs = Math.min(rec.backoffMs * 2, 10_000);
      rec.client.start();
    }, rec.backoffMs);
  }

  private postJson(port: number, pathname: string, body: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 5000,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      req.on('timeout', () => { req.destroy(new Error('peer request timeout')); });
      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  }

  private getJson(port: number, pathname: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: pathname, method: 'GET',
        timeout: 5000,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      req.on('timeout', () => { req.destroy(new Error('peer request timeout')); });
      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  private fetchInfoOnce(info: WindowPresence): Promise<AgentSummary[] | null> {
    if (!info.coordPort) return Promise.resolve(null);
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: info.coordPort,
        path: '/info',
        method: 'GET',
        timeout: 2000,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(Array.isArray(parsed?.agents) ? parsed.agents : null);
          } catch { resolve(null); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
      req.end();
    });
  }
}
