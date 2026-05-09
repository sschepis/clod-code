import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { stateGet, stateSet, stateDelete, stateKeys } from './surface-state';

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
  consoleLogs?: string[];
}

export interface SurfacePanelOptions {
  /** Surface name (without .html extension). */
  name: string;
  /** Absolute path to the HTML file under `.obotovs/surfaces/`. Required unless virtualHtmlProvider is provided. */
  filePath?: string;
  /** Function providing virtual HTML content. If provided, filePath is not read. */
  virtualHtmlProvider?: () => string | Promise<string>;
  /** The workspace root. Used for `localResourceRoots`. */
  workspaceRoot: string;
  /** Current routes server base URL, or null if not started. */
  routesUrl: string | null;
  /** Called when the panel is closed by the user. */
  onDispose: () => void;
  /** Called when the surface JS throws an unhandled error. */
  onError?: (error: SurfaceError) => void;
  /** Called when the surface requests to submit text to an agent. */
  onSubmitToAgent?: (text: string, agentId?: string) => void;
  /** Called when the surface requests to execute a tool. */
  onExecuteTool?: (tool: string, kwargs: Record<string, unknown>) => Promise<any>;
  /** Called when the surface requests LLM generation/streaming. */
  onLlmStream?: (prompt: string, modelType: 'local' | 'remote', onChunk: (chunk: string) => void) => Promise<string>;
  /** Called when this surface's webview becomes the active panel. */
  onDidBecomeActive?: () => void;
  /** Called when the surface emits a channel message. */
  onChannelMessage?: (surfaceName: string, channel: string, data: unknown) => void;
  /** Called when the surface wants to open another surface panel. */
  onOpenSurface?: (name: string) => void;
}

/**
 * One webview panel per surface. Loads the user's HTML verbatim, injecting a
 * permissive-but-localhost-bounded CSP and a `window.__OBOTOVS_ROUTES_URL__`
 * bootstrap script in `<head>`.
 */
export class SurfacePanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly surfacesDir: string;
  private readonly routesDir: string;
  private disposed = false;
  private lastUserHtml = "";

  constructor(private readonly opts: SurfacePanelOptions) {
    this.surfacesDir = opts.filePath ? path.dirname(opts.filePath) : '';
    this.routesDir = path.join(opts.workspaceRoot, '.obotovs', 'routes');

    this.panel = vscode.window.createWebviewPanel(
      'obotovs.surface',
      `Surface: ${opts.name}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(this.surfacesDir),
          vscode.Uri.file(path.join(opts.workspaceRoot, '.obotovs')),
        ],
      },
    );

    this.panel.onDidDispose(() => {
      this.disposed = true;
      opts.onDispose();
    });

    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) opts.onDidBecomeActive?.();
    });

    
    this.panel.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      
      // Surface Error Reporting
      if (m.type === 'obotovs:surface-error' && opts.onError) {
        opts.onError({
          name: this.opts.name,
          message: String(m.message ?? ''),
          stack: typeof m.stack === 'string' ? m.stack : undefined,
          source: typeof m.source === 'string' ? m.source : undefined,
          lineno: typeof m.lineno === 'number' ? m.lineno : undefined,
          colno: typeof m.colno === 'number' ? m.colno : undefined,
          consoleLogs: Array.isArray(m.consoleLogs) ? (m.consoleLogs as string[]).slice(0, 20) : undefined,
        });
      }
      
      // API: Submit to Agent
      if (m.type === 'obotovs:submit-to-agent' && opts.onSubmitToAgent) {
        opts.onSubmitToAgent(String(m.text || ''), m.agentId as string | undefined);
      }
      
      // API: Execute Tool
      if (m.type === 'obotovs:execute-tool' && opts.onExecuteTool) {
        try {
          const result = await opts.onExecuteTool(String(m.tool), m.kwargs as Record<string, unknown>);
          this.panel.webview.postMessage({ 
            type: 'obotovs:tool-result', 
            id: m.id, 
            result 
          });
        } catch (err: any) {
          this.panel.webview.postMessage({ 
            type: 'obotovs:tool-error', 
            id: m.id, 
            error: err.message 
          });
        }
      }
      // API: Channel Message (bidirectional communication)
      if (m.type === 'obotovs:channel-message' && opts.onChannelMessage) {
        opts.onChannelMessage(this.opts.name, String(m.channel || ''), m.data);
      }

      // API: State persistence
      if (m.type === 'obotovs:state-get') {
        const val = stateGet(opts.workspaceRoot, this.opts.name, String(m.key));
        this.panel.webview.postMessage({ type: 'obotovs:state-result', id: m.id, value: val });
      }
      if (m.type === 'obotovs:state-set') {
        stateSet(opts.workspaceRoot, this.opts.name, String(m.key), m.value);
        this.panel.webview.postMessage({ type: 'obotovs:state-result', id: m.id, value: true });
      }
      if (m.type === 'obotovs:state-delete') {
        const ok = stateDelete(opts.workspaceRoot, this.opts.name, String(m.key));
        this.panel.webview.postMessage({ type: 'obotovs:state-result', id: m.id, value: ok });
      }
      if (m.type === 'obotovs:state-keys') {
        const keys = stateKeys(opts.workspaceRoot, this.opts.name);
        this.panel.webview.postMessage({ type: 'obotovs:state-result', id: m.id, value: keys });
      }

      // API: Surface composition
      if (m.type === 'obotovs:open-surface' && opts.onOpenSurface) {
        opts.onOpenSurface(String(m.name || ''));
      }
      if (m.type === 'obotovs:navigate' && opts.onOpenSurface) {
        opts.onOpenSurface(String(m.target || ''));
      }
      if (m.type === 'obotovs:navigate-back' && opts.onOpenSurface) {
        opts.onOpenSurface('__back__');
      }

      // API: LLM Stream
      if (m.type === 'obotovs:llm-stream' && opts.onLlmStream) {
        try {
          const result = await opts.onLlmStream(String(m.prompt), m.modelType as any, (chunk) => {
             this.panel.webview.postMessage({ type: 'obotovs:llm-stream-chunk', id: m.id, chunk });
          });
          this.panel.webview.postMessage({ type: 'obotovs:llm-stream-end', id: m.id, result });
        } catch (err: any) {
          this.panel.webview.postMessage({ type: 'obotovs:llm-stream-error', id: m.id, error: err.message });
        }
      }

    });

    void this.render();
  }

  get name(): string { return this.opts.name; }
  get filePath(): string | undefined { return this.opts.filePath; }

  /** Push a message to this surface on a named channel. */
  pushMessage(channel: string, data: unknown): void {
    if (this.disposed) return;
    this.panel.webview.postMessage({ type: 'obotovs:push', channel, data });
  }

  setRoutesUrl(url: string | null): void {
    if (this.disposed) return;
    this.opts.routesUrl = url;
    // Push the new URL without a full reload via postMessage; the surface
    // can listen for 'obotovs:routes' messages if it wants to react.
    this.panel.webview.postMessage({ type: 'obotovs:routes', url });
    // Also re-render so new `fetch(window.__OBOTOVS_ROUTES_URL__ + …)` calls
    // on hard reload pick up the new URL.
    void this.render();
  }

  reveal(): void {
    if (!this.disposed) this.panel.reveal(vscode.ViewColumn.Active, false);
  }

  postMessage(message: unknown): void {
    if (!this.disposed) this.panel.webview.postMessage(message);
  }

  /**
   * Capture the surface's rendered output as a PNG buffer.
   * Sends a message to the webview which uses html2canvas to render the DOM,
   * then returns the result as base64-encoded PNG data.
   */
  capture(timeoutMs = 15000): Promise<Buffer> {
    if (this.disposed) return Promise.reject(new Error('Surface panel is disposed'));
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.dispose();
        reject(new Error('Screenshot capture timed out'));
      }, timeoutMs);

      const sub = this.panel.webview.onDidReceiveMessage((msg: unknown) => {
        if (!msg || typeof msg !== 'object') return;
        const m = msg as Record<string, unknown>;
        if (m.type === 'obotovs:capture-result') {
          clearTimeout(timer);
          sub.dispose();
          if (typeof m.error === 'string') {
            reject(new Error(m.error));
          } else if (typeof m.data === 'string') {
            resolve(Buffer.from(m.data, 'base64'));
          } else {
            reject(new Error('Capture returned no data'));
          }
        }
      });

      this.panel.webview.postMessage({ type: 'obotovs:capture' });
    });
  }

  /** Called by the manager when the surface file changes on disk. */
  async reload(): Promise<void> {
    if (this.disposed) return;
    let newHtml = '';
    try {
      if (this.opts.virtualHtmlProvider) {
        newHtml = await this.opts.virtualHtmlProvider();
      } else if (this.opts.filePath) {
        newHtml = fs.readFileSync(this.opts.filePath, 'utf8');
      }
    } catch (err) {
      await this.render();
      return;
    }

    const stripStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    if (this.lastUserHtml && stripStyles(this.lastUserHtml) === stripStyles(newHtml)) {
      // Only styles changed — do HMR
      this.lastUserHtml = newHtml;
      this.panel.webview.postMessage({ type: 'obotovs:hmr', html: newHtml });
    } else {
      // Structural/Script changes — full reload
      await this.render();
    }
  }

  dispose(): void {
    if (!this.disposed) this.panel.dispose();
  }

  private async render(): Promise<void> {
    let userHtml = '';
    try {
      if (this.opts.virtualHtmlProvider) {
        userHtml = await this.opts.virtualHtmlProvider();
      } else if (this.opts.filePath) {
        userHtml = fs.readFileSync(this.opts.filePath, 'utf8');
      }
    } catch (err) {
      userHtml = `<!doctype html><html><body><pre style="color:#f87171;font-family:monospace;padding:2rem">Failed to load surface content\\n${err instanceof Error ? err.message : String(err)}</pre></body></html>`;
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
      `  window.__OBOTOVS_ROUTES_URL__ = ${routesUrlJson};\n` +
      `  window.__OBOTOVS_SURFACE__ = ${JSON.stringify(this.opts.name)};\n` +
      `  var vsc = acquireVsCodeApi();\n` +
      // Channel API: bidirectional real-time communication
      `  (function(){\n` +
      `    var _listeners = {};\n` +
      `    window.__obotovs = {\n` +
      `      surface: ${JSON.stringify(this.opts.name)},\n` +
      `      routesUrl: ${routesUrlJson},\n` +
      `      on: function(channel, handler) {\n` +
      `        if (!_listeners[channel]) _listeners[channel] = [];\n` +
      `        _listeners[channel].push(handler);\n` +
      `      },\n` +
      `      off: function(channel, handler) {\n` +
      `        var arr = _listeners[channel]; if (!arr) return;\n` +
      `        _listeners[channel] = arr.filter(function(h) { return h !== handler; });\n` +
      `      },\n` +
      `      emit: function(channel, data) {\n` +
      `        vsc.postMessage({ type: 'obotovs:channel-message', channel: channel, data: data });\n` +
      `      },\n` +
      `      executeTool: function(tool, kwargs) {\n` +
      `        return new Promise(function(resolve, reject) {\n` +
      `          var id = 'tool-' + Date.now() + '-' + Math.random().toString(36).slice(2);\n` +
      `          function handler(e) {\n` +
      `            var d = e && e.data; if (!d) return;\n` +
      `            if (d.type === 'obotovs:tool-result' && d.id === id) {\n` +
      `              window.removeEventListener('message', handler);\n` +
      `              resolve(d.result);\n` +
      `            } else if (d.type === 'obotovs:tool-error' && d.id === id) {\n` +
      `              window.removeEventListener('message', handler);\n` +
      `              reject(new Error(d.error));\n` +
      `            }\n` +
      `          }\n` +
      `          window.addEventListener('message', handler);\n` +
      `          vsc.postMessage({ type: 'obotovs:execute-tool', id: id, tool: tool, kwargs: kwargs || {} });\n` +
      `        });\n` +
      `      },\n` +
      `      submitToAgent: function(text, agentId) {\n` +
      `        vsc.postMessage({ type: 'obotovs:submit-to-agent', text: text, agentId: agentId });\n` +
      `      },\n` +
      // LLM streaming API
      `      llmStream: function(prompt, opts) {\n` +
      `        opts = opts || {};\n` +
      `        var modelType = opts.modelType || 'remote';\n` +
      `        var id = 'llm-' + Date.now() + '-' + Math.random().toString(36).slice(2);\n` +
      `        var onChunk = opts.onChunk || function() {};\n` +
      `        return new Promise(function(resolve, reject) {\n` +
      `          function handler(e) {\n` +
      `            var d = e && e.data; if (!d) return;\n` +
      `            if (d.id !== id) return;\n` +
      `            if (d.type === 'obotovs:llm-stream-chunk') onChunk(d.chunk);\n` +
      `            else if (d.type === 'obotovs:llm-stream-end') {\n` +
      `              window.removeEventListener('message', handler);\n` +
      `              resolve(d.result);\n` +
      `            } else if (d.type === 'obotovs:llm-stream-error') {\n` +
      `              window.removeEventListener('message', handler);\n` +
      `              reject(new Error(d.error));\n` +
      `            }\n` +
      `          }\n` +
      `          window.addEventListener('message', handler);\n` +
      `          vsc.postMessage({ type: 'obotovs:llm-stream', id: id, prompt: prompt, modelType: modelType });\n` +
      `        });\n` +
      `      },\n` +
      // Theme detection
      `      theme: (function() {\n` +
      `        var isDark = document.body.getAttribute('data-vscode-theme-kind') !== 'vscode-light';\n` +
      `        var cbs = [];\n` +
      `        var style = getComputedStyle(document.documentElement);\n` +
      `        var obs = new MutationObserver(function() {\n` +
      `          var newDark = document.body.getAttribute('data-vscode-theme-kind') !== 'vscode-light';\n` +
      `          if (newDark !== isDark) { isDark = newDark; cbs.forEach(function(fn) { fn(isDark); }); }\n` +
      `        });\n` +
      `        try { obs.observe(document.body, { attributes: true, attributeFilter: ['data-vscode-theme-kind'] }); } catch(e) {}\n` +
      `        return {\n` +
      `          get isDark() { return isDark; },\n` +
      `          get isLight() { return !isDark; },\n` +
      `          cssVar: function(name) { return style.getPropertyValue(name).trim(); },\n` +
      `          onChange: function(fn) { cbs.push(fn); },\n` +
      `        };\n` +
      `      })(),\n` +
      // State persistence
      `      state: (function() {\n` +
      `        var pending = {};\n` +
      `        window.addEventListener('message', function(e) {\n` +
      `          var d = e && e.data; if (!d || d.type !== 'obotovs:state-result') return;\n` +
      `          var p = pending[d.id]; if (p) { delete pending[d.id]; p(d.value); }\n` +
      `        });\n` +
      `        function req(type, key, value) {\n` +
      `          return new Promise(function(resolve) {\n` +
      `            var id = 'st-' + Date.now() + '-' + Math.random().toString(36).slice(2);\n` +
      `            pending[id] = resolve;\n` +
      `            var msg = { type: type, id: id };\n` +
      `            if (key !== undefined) msg.key = key;\n` +
      `            if (value !== undefined) msg.value = value;\n` +
      `            vsc.postMessage(msg);\n` +
      `          });\n` +
      `        }\n` +
      `        return {\n` +
      `          get: function(key) { return req('obotovs:state-get', key); },\n` +
      `          set: function(key, val) { return req('obotovs:state-set', key, val); },\n` +
      `          delete: function(key) { return req('obotovs:state-delete', key); },\n` +
      `          keys: function() { return req('obotovs:state-keys'); },\n` +
      `        };\n` +
      `      })(),\n` +
      // Surface composition
      `      openSurface: function(name) {\n` +
      `        vsc.postMessage({ type: 'obotovs:open-surface', name: name });\n` +
      `      },\n` +
      `      navigate: function(surfaceName) {\n` +
      `        vsc.postMessage({ type: 'obotovs:navigate', target: surfaceName });\n` +
      `      },\n` +
      `      back: function() {\n` +
      `        vsc.postMessage({ type: 'obotovs:navigate-back' });\n` +
      `      },\n` +
      // Asset URL helper
      `      assetUrl: function(assetPath) {\n` +
      `        var base = window.__OBOTOVS_ROUTES_URL__;\n` +
      `        if (!base) return null;\n` +
      `        return base + '/__assets/' + assetPath.replace(/^\\/+/, '');\n` +
      `      },\n` +
      // Utility functions
      `      debounce: function(fn, ms) {\n` +
      `        var t; return function() { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function() { fn.apply(c, a); }, ms); };\n` +
      `      },\n` +
      `      throttle: function(fn, ms) {\n` +
      `        var last = 0; return function() { var now = Date.now(); if (now - last >= ms) { last = now; fn.apply(this, arguments); } };\n` +
      `      },\n` +
      `    };\n` +
      `    window.addEventListener('message', function(e) {\n` +
      `      var d = e && e.data; if (!d) return;\n` +
      `      if (d.type === 'obotovs:push') {\n` +
      `        var arr = _listeners[d.channel];\n` +
      `        if (arr) arr.forEach(function(fn) { try { fn(d.data); } catch(e) { console.error(e); } });\n` +
      `        if (d.channel === '__health-check') {\n` +
      `          vsc.postMessage({ type: 'obotovs:channel-message', channel: '__health-ok', data: { surface: window.__obotovs.surface } });\n` +
      `        }\n` +
      `      }\n` +
      `      if (d.type === 'obotovs:routes') {\n` +
      `        window.__obotovs.routesUrl = d.url;\n` +
      `      }\n` +
      `    });\n` +
      `  })();\n` +
      `  window.addEventListener('message', function(e){\n` +
      `    var d = e && e.data; if (!d) return;\n` +
      `    if (d.type === 'obotovs:routes') window.__OBOTOVS_ROUTES_URL__ = d.url;\n` +
      `    if (d.type === 'obotovs:capture') {\n` +
      `      (function() {\n` +
      `        function doCapture() {\n` +
      `          html2canvas(document.body, { useCORS: true, logging: false, scale: 1 }).then(function(canvas) {\n` +
      `            var dataUrl = canvas.toDataURL('image/png');\n` +
      `            var base64 = dataUrl.replace(/^data:image\\/png;base64,/, '');\n` +
      `            vsc.postMessage({ type: 'obotovs:capture-result', data: base64 });\n` +
      `          }).catch(function(err) {\n` +
      `            vsc.postMessage({ type: 'obotovs:capture-result', error: err.message || String(err) });\n` +
      `          });\n` +
      `        }\n` +
      `        if (window.html2canvas) { doCapture(); return; }\n` +
      `        var script = document.createElement('script');\n` +
      `        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';\n` +
      `        script.onload = doCapture;\n` +
      `        script.onerror = function() {\n` +
      `          vsc.postMessage({ type: 'obotovs:capture-result', error: 'Failed to load html2canvas from CDN' });\n` +
      `        };\n` +
      `        document.head.appendChild(script);\n` +
      `      })();\n` +
      `    }\n` +
      `    if (d.type === 'obotovs:hmr') {\n` +
      `      var parser = new DOMParser();\n` +
      `      var doc = parser.parseFromString(d.html, 'text/html');\n` +
      `      var newStyles = doc.querySelectorAll('style');\n` +
      `      var oldStyles = document.querySelectorAll('style');\n` +
      `      oldStyles.forEach(function(s) { s.remove(); });\n` +
      `      newStyles.forEach(function(s) { document.head.appendChild(s); });\n` +
      `      console.log('[obotovs] HMR: Updated styles without reloading');\n` +
      `    }\n` +
      `  });\n` +
      `  (function(){\n` +
      `    var sent = {};\n` +
      `    var consoleLogs = [];\n` +
      `    var MAX_CONSOLE_LOGS = 20;\n` +
      `    var origError = console.error;\n` +
      `    console.error = function() {\n` +
      `      var args = Array.prototype.slice.call(arguments);\n` +
      `      var msg = args.map(function(a) {\n` +
      `        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }\n` +
      `        catch(e) { return String(a); }\n` +
      `      }).join(' ');\n` +
      `      if (consoleLogs.length >= MAX_CONSOLE_LOGS) consoleLogs.shift();\n` +
      `      consoleLogs.push(msg);\n` +
      `      origError.apply(console, arguments);\n` +
      `    };\n` +
      `    function report(msg, src, line, col, stack) {\n` +
      `      var key = msg + ':' + (line||0);\n` +
      `      if (sent[key]) return;\n` +
      `      sent[key] = 1;\n` +
      `      vsc.postMessage({ type: 'obotovs:surface-error', message: msg, source: src, lineno: line, colno: col, stack: stack, consoleLogs: consoleLogs.slice() });\n` +
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
