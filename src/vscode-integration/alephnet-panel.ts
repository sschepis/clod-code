import * as vscode from 'vscode';
import * as alephApi from '../config/alephnet-api';
import { getAlephNetStatus } from '../config/alephnet-manager';

let currentPanel: vscode.WebviewPanel | undefined;

export async function openAlephNetProfile(extensionUri: vscode.Uri) {
  if (currentPanel) {
    currentPanel.reveal();
    await refreshPanel();
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'alephnetProfile',
    'AlephNet — Me',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  currentPanel.iconPath = new vscode.ThemeIcon('account');

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });

  currentPanel.webview.onDidReceiveMessage(async (msg: { command: string }) => {
    if (msg.command === 'refresh') {
      await refreshPanel();
    }
  });

  await refreshPanel();
}

async function refreshPanel() {
  if (!currentPanel) return;

  const status = await getAlephNetStatus();
  const identity = status.connected ? await alephApi.getIdentity() : null;
  const nodeStatus = status.connected ? await alephApi.getStatus() : null;
  const introspect = status.connected ? await alephApi.getIntrospect() : null;

  currentPanel.webview.html = buildHtml(status, identity, nodeStatus, introspect);
}

function buildHtml(
  status: { connected: boolean; port: number },
  identity: alephApi.AlephNetIdentity | null,
  nodeStatus: alephApi.AlephNetStatus | null,
  introspect: Record<string, unknown> | null,
): string {
  if (!status.connected) {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>${baseStyles()}</style>
</head><body>
<div class="container">
  <h1>AlephNet</h1>
  <div class="card warning">
    <h2>Not Connected</h2>
    <p>The AlephNet node is not running on port ${status.port}.</p>
    <p>Enable it in VS Code settings: <code>obotovs.alephnet.enabled = true</code></p>
  </div>
  <button onclick="refresh()">Retry</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  function refresh() { vscode.postMessage({ command: 'refresh' }); }
</script>
</body></html>`;
  }

  const nodeId = identity?.nodeId ?? nodeStatus?.nodeId ?? 'Unknown';
  const name = identity?.name ?? 'Unnamed Node';
  const tier = identity?.tier ?? 0;
  const balance = identity?.balance ?? 0;
  const reputation = identity?.reputation ?? 0;
  const uptime = nodeStatus?.uptime ? formatUptime(nodeStatus.uptime) : 'N/A';
  const connections = nodeStatus?.connections ?? 0;

  const cognitiveHtml = introspect
    ? `<div class="card">
        <h2>Cognitive State</h2>
        <pre>${JSON.stringify(introspect, null, 2)}</pre>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>${baseStyles()}</style>
</head><body>
<div class="container">
  <h1>AlephNet — Me</h1>
  <button class="refresh-btn" onclick="refresh()">Refresh</button>

  <div class="card">
    <h2>${escapeHtml(name)}</h2>
    <div class="grid">
      <div class="field"><span class="label">Node ID</span><span class="value mono">${escapeHtml(nodeId)}</span></div>
      <div class="field"><span class="label">Tier</span><span class="value">${tier}</span></div>
      <div class="field"><span class="label">Balance</span><span class="value">${balance} &#x2135;</span></div>
      <div class="field"><span class="label">Reputation</span><span class="value">${reputation}</span></div>
    </div>
  </div>

  <div class="card">
    <h2>Network</h2>
    <div class="grid">
      <div class="field"><span class="label">Status</span><span class="value connected">Connected</span></div>
      <div class="field"><span class="label">Port</span><span class="value">${status.port}</span></div>
      <div class="field"><span class="label">Uptime</span><span class="value">${uptime}</span></div>
      <div class="field"><span class="label">Connections</span><span class="value">${connections}</span></div>
    </div>
  </div>

  ${cognitiveHtml}
</div>
<script>
  const vscode = acquireVsCodeApi();
  function refresh() { vscode.postMessage({ command: 'refresh' }); }
</script>
</body></html>`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
    }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { font-size: 1.6em; margin-bottom: 16px; }
    h2 { font-size: 1.1em; margin-bottom: 12px; color: var(--vscode-descriptionForeground); }
    .card {
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #333));
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card.warning {
      border-color: var(--vscode-inputValidation-warningBorder, #b89500);
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 2px; }
    .label { font-size: 0.8em; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; }
    .value { font-size: 1em; }
    .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; word-break: break-all; }
    .connected { color: var(--vscode-testing-iconPassed, #4ec9b0); }
    pre {
      background: var(--vscode-textCodeBlock-background, #1e1e1e);
      padding: 12px;
      border-radius: 4px;
      font-size: 0.8em;
      overflow-x: auto;
      max-height: 400px;
      overflow-y: auto;
    }
    button, .refresh-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9em;
      margin-bottom: 16px;
    }
    button:hover, .refresh-btn:hover { background: var(--vscode-button-hoverBackground); }
    code {
      background: var(--vscode-textCodeBlock-background, #1e1e1e);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.9em;
    }
    p { margin: 6px 0; line-height: 1.5; }
  `;
}
