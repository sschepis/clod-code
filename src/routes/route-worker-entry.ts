import { parentPort, workerData } from 'worker_threads';
import * as http from 'http';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { scanRoutes, matchRoute, type RouteEntry } from './route-loader';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const;
type Method = typeof METHODS[number];

const dynamicImport: (spec: string) => Promise<any> =
  new Function('spec', 'return import(spec)') as any;

export function runRouteWorker() {
  if (!parentPort || !workerData) return;

  const { workspaceRoot, port, apiPrefix } = workerData;
  let entries: RouteEntry[] = [];
  let server: http.Server | undefined;

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

  server.listen(port, '127.0.0.1', () => {
    parentPort!.postMessage({ type: 'ready' });
  });

  server.on('error', (err) => {
    parentPort!.postMessage({ type: 'error', error: err.message });
  });

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

    if (!url.pathname.startsWith(apiPrefix + '/') && url.pathname !== apiPrefix) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No route for ${url.pathname}` }));
      return;
    }
    const subPath = url.pathname.slice(apiPrefix.length) || '/';

    const match = matchRoute(entries, subPath);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No route for ${url.pathname}` }));
      return;
    }

    let mtime = 0;
    try { mtime = fs.statSync(match.entry.file).mtimeMs; } catch { /* ignore */ }
    const moduleUrl = `${pathToFileURL(match.entry.file).href}?v=${mtime}`;

    let mod: any;
    try {
      mod = await dynamicImport(moduleUrl);
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
      result = await handler(fetchReq, { params: match.params });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: errMsg(err) }));
      return;
    }

    await sendResponse(res, result);
  }
}

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
