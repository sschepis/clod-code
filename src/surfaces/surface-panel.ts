import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export interface SurfaceError {
  name: string;
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
}

export interface SurfacePanelOptions {
  /** Surface name (without .html extension). */
  name: string;
  /** Absolute path to the HTML file under `.clodcode/surfaces/`. */
  filePath: string;
  /** The workspace root. Used for `localResourceRoots`. */
  workspaceRoot: string;
  /** Current routes server base URL, or null if not started. */
  routesUrl: string | null;
  /** Called when the panel is closed by the user. */
  onDispose: () => void;
  /** Called when the surface JS throws an unhandled error. */
  onError?: (error: SurfaceError) => void;
}

/**
 * One webview panel per surface. Loads the user's HTML verbatim, injecting a
 * permissive-but-localhost-bounded CSP and a `window.__CLODCODE_ROUTES_URL__`
 * bootstrap script in `<head>`.
 */
export class SurfacePanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly surfacesDir: string;
  private readonly routesDir: string;
  private disposed = false;
  private lastUserHtml = "";

  constructor(private readonly opts: SurfacePanelOptions) {
    this.surfacesDir = path.dirname(opts.filePath);
    this.routesDir = path.join(opts.workspaceRoot, '.clodcode', 'routes');

    this.panel = vscode.window.createWebviewPanel(
      'clodcode.surface',
      `Surface: ${opts.name}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(this.surfacesDir),
          vscode.Uri.file(path.join(opts.workspaceRoot, '.clodcode')),
        ],
      },
    );

    this.panel.onDidDispose(() => {
      this.disposed = true;
      opts.onDispose();
    });

    this.panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m.type === 'clodcode:surface-error' && opts.onError) {
        opts.onError({
          name: this.opts.name,
          message: String(m.message ?? ''),
          stack: typeof m.stack === 'string' ? m.stack : undefined,
          source: typeof m.source === 'string' ? m.source : undefined,
          lineno: typeof m.lineno === 'number' ? m.lineno : undefined,
          colno: typeof m.colno === 'number' ? m.colno : undefined,
        });
      }
    });

    this.render();
  }

  get name(): string { return this.opts.name; }

  setRoutesUrl(url: string | null): void {
    if (this.disposed) return;
    this.opts.routesUrl = url;
    // Push the new URL without a full reload via postMessage; the surface
    // can listen for 'clodcode:routes' messages if it wants to react.
    this.panel.webview.postMessage({ type: 'clodcode:routes', url });
    // Also re-render so new `fetch(window.__CLODCODE_ROUTES_URL__ + …)` calls
    // on hard reload pick up the new URL.
    this.render();
  }

  reveal(): void {
    if (!this.disposed) this.panel.reveal(vscode.ViewColumn.Active, false);
  }

  /** Called by the manager when the surface file changes on disk. */
  reload(): void {
    if (this.disposed) return;
    let newHtml = '';
    try {
      newHtml = fs.readFileSync(this.opts.filePath, 'utf8');
    } catch (err) {
      this.render();
      return;
    }

    const stripStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    if (this.lastUserHtml && stripStyles(this.lastUserHtml) === stripStyles(newHtml)) {
      // Only styles changed — do HMR
      this.lastUserHtml = newHtml;
      this.panel.webview.postMessage({ type: 'clodcode:hmr', html: newHtml });
    } else {
      // Structural/Script changes — full reload
      this.render();
    }
  }

  dispose(): void {
    if (!this.disposed) this.panel.dispose();
  }

  private render(): void {
    let userHtml = '';
    try {
      userHtml = fs.readFileSync(this.opts.filePath, 'utf8');
    } catch (err) {
      userHtml = `<!doctype html><html><body><pre style="color:#f87171;font-family:monospace;padding:2rem">Failed to read ${this.opts.filePath}\n${err instanceof Error ? err.message : String(err)}</pre></body></html>`;
    }

    this.lastUserHtml = userHtml;
    this.panel.webview.html = this.buildHtml(userHtml);
  }

  private buildHtml(userHtml: string): string {
    const nonce = getNonce();
    const cspSource = this.panel.webview.cspSource;
    const csp = [
      `default-src 'none'`,
      `script-src ${cspSource} 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://esm.sh https://cdn.tailwindcss.com`,
      `style-src ${cspSource} 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com`,
      `font-src ${cspSource} data: https://fonts.gstatic.com`,
      `img-src ${cspSource} data: blob: https:`,
      `connect-src http://127.0.0.1:* ws://127.0.0.1:*`,
      `frame-src 'none'`,
    ].join('; ');

    const routesUrlJson = this.opts.routesUrl === null ? 'null' : JSON.stringify(this.opts.routesUrl);

    const injections =
      `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` +
      `<script nonce="${nonce}">\n` +
      `  window.__CLODCODE_ROUTES_URL__ = ${routesUrlJson};\n` +
      `  window.__CLODCODE_SURFACE__ = ${JSON.stringify(this.opts.name)};\n` +
      `  window.addEventListener('message', function(e){\n` +
      `    var d = e && e.data; if (!d) return;\n` +
      `    if (d.type === 'clodcode:routes') window.__CLODCODE_ROUTES_URL__ = d.url;\n` +
      `    if (d.type === 'clodcode:hmr') {\n` +
      `      var parser = new DOMParser();\n` +
      `      var doc = parser.parseFromString(d.html, 'text/html');\n` +
      `      var newStyles = doc.querySelectorAll('style');\n` +
      `      var oldStyles = document.querySelectorAll('style');\n` +
      `      oldStyles.forEach(function(s) { s.remove(); });\n` +
      `      newStyles.forEach(function(s) { document.head.appendChild(s); });\n` +
      `      console.log('[clodcode] HMR: Updated styles without reloading');\n` +
      `    }\n` +
      `  });\n` +
      `  (function(){\n` +
      `    var vsc = acquireVsCodeApi();\n` +
      `    var sent = {};\n` +
      `    function report(msg, src, line, col, stack) {\n` +
      `      var key = msg + ':' + (line||0);\n` +
      `      if (sent[key]) return;\n` +
      `      sent[key] = 1;\n` +
      `      vsc.postMessage({ type: 'clodcode:surface-error', message: msg, source: src, lineno: line, colno: col, stack: stack });\n` +
      `    }\n` +
      `    window.onerror = function(msg, src, line, col, err) {\n` +
      `      report(String(msg), src, line, col, err && err.stack ? err.stack : undefined);\n` +
      `    };\n` +
      `    window.addEventListener('unhandledrejection', function(e) {\n` +
      `      var r = e.reason;\n` +
      `      report(r && r.message ? r.message : String(r), undefined, undefined, undefined, r && r.stack ? r.stack : undefined);\n` +
      `    });\n` +
      `  })();\n` +
      `</script>\n`;

    // Inject into <head>; if the user hasn't written <head>, prepend a full skeleton.
    const headMatch = /<head(\b[^>]*)?>/i.exec(userHtml);
    if (headMatch) {
      const insertAt = headMatch.index + headMatch[0].length;
      return userHtml.slice(0, insertAt) + '\n' + injections + userHtml.slice(insertAt);
    }
    // No <head> — wrap the user's content.
    return `<!doctype html>
<html>
<head>
${injections}
</head>
<body>
${userHtml}
</body>
</html>`;
  }
}
