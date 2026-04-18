import * as http from 'http';
import type { PeerEvent } from './peer-server';

export interface PeerClientOptions {
  port: number;
  onEvent: (event: PeerEvent) => void;
  onClose?: (err?: Error) => void;
}

/**
 * Minimal SSE client against a peer's `/events` endpoint on 127.0.0.1. Parses
 * `event:` + `data:` lines; other SSE fields are ignored. Close via `abort()`.
 */
export class PeerClient {
  private req?: http.ClientRequest;
  private res?: http.IncomingMessage;
  private buffer = '';
  private closed = false;

  constructor(private readonly opts: PeerClientOptions) {}

  start(): void {
    const req = http.request({
      host: '127.0.0.1',
      port: this.opts.port,
      path: '/events',
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      this.res = res;
      if (res.statusCode !== 200) {
        this.close(new Error(`peer /events returned ${res.statusCode}`));
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => this.onChunk(chunk));
      res.on('end', () => this.close());
      res.on('error', (err) => this.close(err));
    });

    req.on('error', (err) => this.close(err));
    req.end();
    this.req = req;
  }

  abort(): void { this.close(); }

  private onChunk(chunk: string): void {
    this.buffer += chunk;
    // SSE messages end with a blank line (\n\n).
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.parseMessage(raw);
    }
  }

  private parseMessage(raw: string): void {
    let type = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const joined = dataLines.join('\n');
    try {
      const parsed = JSON.parse(joined);
      // Trust `type` from the event-line if present; else fall back to payload's own type.
      if (parsed && typeof parsed === 'object') {
        if (!parsed.type) parsed.type = type;
        this.opts.onEvent(parsed as PeerEvent);
      }
    } catch {
      // Non-JSON SSE event — ignore for Phase A.
    }
  }

  private close(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    try { this.req?.destroy(); } catch { /* ignore */ }
    try { this.res?.destroy(); } catch { /* ignore */ }
    this.opts.onClose?.(err);
  }
}
