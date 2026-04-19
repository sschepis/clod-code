import * as http from 'http';
import type { AgentSummary } from '../shared/message-types';
import { logger } from '../shared/logger';

export interface DispatchRequestBody {
  fromWindowId: string;
  task: string;
  label?: string;
}

export interface DispatchResponseBody {
  rpcId: string;
}

export interface DispatchStatusBody {
  status: string;
  result?: string;
  error?: string;
  reason?: string;
  cost?: { totalTokens: number; totalCost: number };
  completedAt?: number;
}

export interface AskRequestBody {
  fromWindowId: string;
  question: string;
  /** Array of choice strings; ignored when inputMode === 'text'. */
  choices: string[];
  defaultChoice?: number;
  /** 'choice' (default) or 'text'. */
  inputMode?: 'choice' | 'text';
}

export interface AskResponseBody {
  rpcId: string;
}

export interface AskStatusBody {
  status: string;
  answerIndex?: number;
  answerText?: string;
  reason?: string;
  completedAt?: number;
}

export interface CancelRequestBody {
  fromWindowId: string;
  rpcId: string;
}

export interface CancelResponseBody {
  ok: boolean;
  reason?: string;
}

export interface PeerServerOptions {
  windowId: string;
  /** Called when the server needs to know this window's agent summaries. */
  getAgents: () => AgentSummary[];
  /** Called on an incoming `POST /dispatch`. Synchronous — just register the
   *  record and kick off the approval UI; the actual agent spawn happens
   *  asynchronously. Return the rpcId for the caller to poll. Returning null
   *  rejects the request (e.g. when a setting gates this off). */
  onDispatchReceived?: (req: DispatchRequestBody) => DispatchResponseBody | null;
  /** Look up a dispatch record for `GET /dispatch-status?rpcId=...`. */
  getDispatchStatus?: (rpcId: string) => DispatchStatusBody | null;
  /** Called on an incoming `POST /ask`. Register a pending question, show it
   *  in the webview, return its rpcId. Null rejects. */
  onAskReceived?: (req: AskRequestBody) => AskResponseBody | null;
  /** Look up a peer-ask record for `GET /ask-status?rpcId=...`. */
  getAskStatus?: (rpcId: string) => AskStatusBody | null;
  /** Called on an incoming `POST /cancel`. Cancels a dispatch started by the
   *  same peer. Return ok=false if the rpcId isn't found or isn't cancellable. */
  onCancelReceived?: (req: CancelRequestBody) => CancelResponseBody;
}

export interface PeerEvent {
  type:
    | 'hello'
    | 'heartbeat'
    | 'agents_changed'
    | 'goodbye'
    | 'ask_resolved'
    | 'dispatch_resolved';
  windowId: string;
  at: number;
  agents?: AgentSummary[];
  /** Present on `ask_resolved`. */
  askResolved?: {
    rpcId: string;
    status: string;
    answerIndex?: number;
    answerText?: string;
    reason?: string;
  };
  /** Present on `dispatch_resolved`. */
  dispatchResolved?: {
    rpcId: string;
    status: string;
    result?: string;
    error?: string;
    reason?: string;
    completedAt?: number;
  };
}

/**
 * Small HTTP + SSE server that advertises this window's presence to peers
 * running in other VS Code windows on the same workspace. Binds to a random
 * free loopback port — the chosen port is stored in `.obotovs/windows/<id>.json`
 * so peers can discover it.
 */
export class PeerServer {
  private server?: http.Server;
  private port = 0;
  private startedAt = 0;
  private readonly clients = new Set<http.ServerResponse>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly opts: PeerServerOptions) {}

  async start(): Promise<number> {
    this.startedAt = Date.now();
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => { cleanup(); reject(e); };
      const onListen = () => { cleanup(); resolve(); };
      const cleanup = () => {
        this.server!.off('error', onErr);
        this.server!.off('listening', onListen);
      };
      this.server!.once('error', onErr);
      this.server!.once('listening', onListen);
      // `listen(0)` → OS assigns a free port.
      this.server!.listen(0, '127.0.0.1');
    });
    const addr = this.server!.address();
    this.port = typeof addr === 'object' && addr ? addr.port : 0;
    logger.info(`[peers] server listening on 127.0.0.1:${this.port}`);

    this.heartbeatTimer = setInterval(() => {
      this.broadcast({
        type: 'heartbeat',
        windowId: this.opts.windowId,
        at: Date.now(),
      });
    }, 15_000);

    return this.port;
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;

    this.broadcast({ type: 'goodbye', windowId: this.opts.windowId, at: Date.now() });

    for (const res of this.clients) {
      try { res.end(); } catch { /* ignore */ }
    }
    this.clients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = undefined;
    }
  }

  /** Push an event to every connected SSE client. */
  broadcast(event: PeerEvent): void {
    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      try { res.write(data); } catch { /* client will clean up on close */ }
    }
  }

  notifyAgentsChanged(): void {
    this.broadcast({
      type: 'agents_changed',
      windowId: this.opts.windowId,
      at: Date.now(),
      agents: this.opts.getAgents(),
    });
  }

  notifyAskResolved(payload: NonNullable<PeerEvent['askResolved']>): void {
    this.broadcast({
      type: 'ask_resolved',
      windowId: this.opts.windowId,
      at: Date.now(),
      askResolved: payload,
    });
  }

  notifyDispatchResolved(payload: NonNullable<PeerEvent['dispatchResolved']>): void {
    this.broadcast({
      type: 'dispatch_resolved',
      windowId: this.opts.windowId,
      at: Date.now(),
      dispatchResolved: payload,
    });
  }

  getPort(): number { return this.port; }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, windowId: this.opts.windowId, pid: process.pid, port: this.port }));
      return;
    }

    if (url.pathname === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        windowId: this.opts.windowId,
        pid: process.pid,
        startedAt: this.startedAt,
        agents: this.opts.getAgents(),
      }));
      return;
    }

    if (url.pathname === '/dispatch' && req.method === 'POST') {
      this.handleDispatch(req, res);
      return;
    }

    if (url.pathname === '/dispatch-status' && req.method === 'GET') {
      const rpcId = url.searchParams.get('rpcId') ?? '';
      const status = this.opts.getDispatchStatus?.(rpcId) ?? null;
      if (!status) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no such rpcId' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (url.pathname === '/ask' && req.method === 'POST') {
      this.handleAsk(req, res);
      return;
    }

    if (url.pathname === '/ask-status' && req.method === 'GET') {
      const rpcId = url.searchParams.get('rpcId') ?? '';
      const status = this.opts.getAskStatus?.(rpcId) ?? null;
      if (!status) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no such rpcId' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (url.pathname === '/cancel' && req.method === 'POST') {
      this.handleCancel(req, res);
      return;
    }

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
      });
      // Immediate hello so the subscriber has everything right away.
      const hello: PeerEvent = {
        type: 'hello',
        windowId: this.opts.windowId,
        at: Date.now(),
        agents: this.opts.getAgents(),
      };
      res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
      this.clients.add(res);
      logger.info(`[peers] SSE client connected (total=${this.clients.size}), sent hello with ${hello.agents?.length ?? 0} agent(s)`);
      const onClose = () => {
        this.clients.delete(res);
        logger.info(`[peers] SSE client disconnected (remaining=${this.clients.size})`);
      };
      req.on('close', onClose);
      res.on('close', onClose);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }

  private handleDispatch(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readBody(req, res, (parsed) => {
      if (typeof (parsed as any)?.fromWindowId !== 'string' ||
          typeof (parsed as any)?.task !== 'string' ||
          !(parsed as any).task.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request shape' }));
        return;
      }
      const handled = this.opts.onDispatchReceived?.(parsed as DispatchRequestBody) ?? null;
      if (!handled) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'dispatch disabled' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handled));
    });
  }

  private handleAsk(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readBody(req, res, (parsed) => {
      const body = parsed as AskRequestBody;
      if (typeof body?.fromWindowId !== 'string' ||
          typeof body?.question !== 'string' || !body.question.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request shape' }));
        return;
      }
      const mode = body.inputMode === 'text' ? 'text' : 'choice';
      // Choice mode requires ≥ 2 options; text mode doesn't.
      if (mode === 'choice' && (!Array.isArray(body.choices) || body.choices.length < 2)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'choice mode requires at least 2 choices' }));
        return;
      }
      const handled = this.opts.onAskReceived?.({
        ...body,
        choices: Array.isArray(body.choices) ? body.choices : [],
        inputMode: mode,
      }) ?? null;
      if (!handled) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ask disabled' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handled));
    });
  }

  private handleCancel(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readBody(req, res, (parsed) => {
      const body = parsed as CancelRequestBody;
      if (typeof body?.fromWindowId !== 'string' ||
          typeof body?.rpcId !== 'string' || !body.rpcId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request shape' }));
        return;
      }
      const handled = this.opts.onCancelReceived?.(body) ?? { ok: false, reason: 'cancel not supported' };
      res.writeHead(handled.ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handled));
    });
  }

  private readBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cont: (parsed: unknown) => void,
  ): void {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      try {
        cont(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
    req.on('error', () => {
      try { res.writeHead(400); res.end(); } catch { /* already ended */ }
    });
  }
}
