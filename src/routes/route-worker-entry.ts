import { parentPort, workerData } from 'worker_threads';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Duplex } from 'stream';
import { pathToFileURL } from 'url';
import { scanRoutes, matchRoute, type RouteEntry } from './route-loader';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const;
type Method = typeof METHODS[number];

const dynamicImport: (spec: string) => Promise<any> =
  new Function('spec', 'return import(spec)') as any;

// ── Minimal WebSocket implementation (RFC 6455) ──────────────────────

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB5DC525DA5';

export interface SimpleWebSocket {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', handler: (data: string | Buffer) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
}

function createWebSocket(socket: Duplex): SimpleWebSocket {
  const handlers: Record<string, Function[]> = {};

  function on(event: string, handler: Function) {
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(handler);
  }

  function emit(event: string, ...args: unknown[]) {
    for (const fn of handlers[event] ?? []) {
      try { fn(...args); } catch { /* swallow */ }
    }
  }

  function send(data: string | Buffer) {
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const opcode = typeof data === 'string' ? 0x01 : 0x02;
    const len = payload.length;

    let header: Buffer;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  function close(code = 1000, reason = '') {
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    const header = Buffer.alloc(2);
    header[0] = 0x88;
    header[1] = payload.length;
    socket.write(Buffer.concat([header, payload]));
    socket.end();
  }

  let buf = Buffer.alloc(0);

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let payloadLen = buf[1] & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buf.length < 4) return;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) return;
        payloadLen = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      const totalLen = offset + maskLen + payloadLen;
      if (buf.length < totalLen) return;

      let payload = buf.subarray(offset + maskLen, totalLen);
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }

      buf = buf.subarray(totalLen);

      if (opcode === 0x01) {
        emit('message', payload.toString('utf8'));
      } else if (opcode === 0x02) {
        emit('message', payload);
      } else if (opcode === 0x08) {
        emit('close');
        socket.end();
      } else if (opcode === 0x09) {
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a;
        pong[1] = 0;
        socket.write(pong);
      }
    }
  });

  socket.on('close', () => emit('close'));
  socket.on('error', (err: Error) => emit('error', err));

  return { send, close, on } as SimpleWebSocket;
}

// ── Main worker ──────────────────────────────────────────────────────

export function runRouteWorker() {
  if (!parentPort || !workerData) return;

  const { workspaceRoot, port, apiPrefix } = workerData;
  let entries: RouteEntry[] = [];
  let server: http.Server | undefined;
  const sharedStore = new Map<string, unknown>();

  function rescan() {
    entries = scanRoutes(workspaceRoot);
  }

  parentPort.on('message', (msg) => {
    if (msg.type === 'rescan') {
      rescan();
    } else if (msg.type === 'stop') {
      if (server) server.close(() => process.exit(0));
      else process.exit(0);
    }
  });

  rescan();

  server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head).catch(() => {
      socket.destroy();
    });
  });

  server.listen(port, '127.0.0.1', () => {
    parentPort!.postMessage({ type: 'ready' });
  });

  server.on('error', (err) => {
    parentPort!.postMessage({ type: 'error', error: err.message });
  });

  async function loadRouteModule(filePath: string): Promise<any> {
    let mtime = 0;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch { /* ignore */ }
    const moduleUrl = `${pathToFileURL(filePath).href}?v=${mtime}`;
    return dynamicImport(moduleUrl);
  }

  function resolveRoute(pathname: string): { match: ReturnType<typeof matchRoute>; subPath: string } | null {
    if (!pathname.startsWith(apiPrefix + '/') && pathname !== apiPrefix) return null;
    const subPath = pathname.slice(apiPrefix.length) || '/';
    const match = matchRoute(entries, subPath);
    return match ? { match, subPath } : null;
  }

  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.xml': 'application/xml',
  };

  const assetsDir = path.join(workspaceRoot, '.obotovs', 'assets');
  const assetsPrefix = apiPrefix + '/__assets/';

  function serveAsset(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith(assetsPrefix)) return false;

    const relPath = decodeURIComponent(url.pathname.slice(assetsPrefix.length));
    const resolved = path.resolve(assetsDir, relPath);
    if (!resolved.startsWith(assetsDir + path.sep) && resolved !== assetsDir) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return true;
    }

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return true;
      }
      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(resolved).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return true;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (serveAsset(req, res)) return;

    const resolved = resolveRoute(url.pathname);
    if (!resolved) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No route for ${url.pathname}` }));
      return;
    }

    let mod: any;
    try {
      mod = await loadRouteModule(resolved.match!.entry.file);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to load route: ${errMsg(err)}` }));
      return;
    }

    const handler =
      (METHODS as readonly string[]).includes(method)
        ? (mod[method as Method] ?? mod.default)
        : mod.default;

    if (typeof handler !== 'function') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': exportedMethods(mod).join(', ') });
      res.end(JSON.stringify({ error: `Method ${method} not allowed for ${url.pathname}` }));
      return;
    }

    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
    const fetchReq = new Request(`http://127.0.0.1${req.url ?? '/'}`, {
      method,
      headers: httpHeaders(req.headers),
      body,
    });

    let result: any;
    try {
      result = await handler(fetchReq, { params: resolved.match!.params, store: sharedStore });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: errMsg(err) }));
      return;
    }

    await sendResponse(res, result);
  }

  async function handleUpgrade(req: http.IncomingMessage, socket: Duplex, _head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const resolved = resolveRoute(url.pathname);
    if (!resolved) { socket.destroy(); return; }

    let mod: any;
    try {
      mod = await loadRouteModule(resolved.match!.entry.file);
    } catch {
      socket.destroy();
      return;
    }

    if (typeof mod.WEBSOCKET !== 'function') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const accept = crypto
      .createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
    );

    const ws = createWebSocket(socket);

    try {
      await mod.WEBSOCKET(ws, req, { params: resolved.match!.params, store: sharedStore });
    } catch {
      ws.close(1011, 'Handler error');
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function exportedMethods(mod: any): string[] {
  return METHODS.filter((m) => typeof mod?.[m] === 'function');
}

function httpHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (Array.isArray(v)) out[k] = v.join(', ');
    else if (typeof v === 'string') out[k] = v;
  }
  return out;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendResponse(res: http.ServerResponse, result: unknown): Promise<void> {
  if (result && typeof result === 'object' && typeof (result as Response).status === 'number' && typeof (result as Response).headers === 'object') {
    const r = result as Response;
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    if (r.body) {
      if (typeof (r.body as any).getReader === 'function') {
        const reader = (r.body as any).getReader();
        res.on('close', () => reader.cancel().catch(() => {}));
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (err) {
          res.end();
        }
      } else {
        const buf = Buffer.from(await r.arrayBuffer());
        res.end(buf);
      }
    } else {
      res.end();
    }
    return;
  }
  if (typeof result === 'string') {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.writeHead(200);
    res.end(result);
    return;
  }
  if (Buffer.isBuffer(result)) {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
    res.writeHead(200);
    res.end(result);
    return;
  }
  if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(result ?? {}));
}
