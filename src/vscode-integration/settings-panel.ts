import * as vscode from 'vscode';
import { createProvider, type ProviderName } from '@sschepis/llm-wrapper';
import { EXTENSION_ID } from '../shared/constants';
import type {
  SettingsExtToWebview, SettingsWebviewToExt,
  SettingsState, ProviderOption,
} from '../shared/message-types';
import { PROVIDERS, resolveApiKey, normalizeBaseUrl } from '../config/provider-registry';
import { getSettings } from '../config/settings';
import { logger } from '../shared/logger';
import { getErrorMessage } from '../shared/errors';

/**
 * A WebviewPanel that lets the user configure all Clodcode settings
 * via a friendly form UI instead of editing settings.json by hand.
 */
export class SettingsPanel {
  public static readonly viewType = 'clodcode.settingsPanel';
  private static currentPanel: SettingsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'Clodcode Settings',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist'),
          vscode.Uri.joinPath(extensionUri, 'dist'),
        ],
      }
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this._getHtml(extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (msg: SettingsWebviewToExt) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async handleMessage(msg: SettingsWebviewToExt): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.sync();
        break;

      case 'save':
        await this.saveSettings(msg.settings);
        break;

      case 'test_connection':
        await this.testConnection(msg.target, msg.overrides);
        break;

      case 'reset_to_defaults':
        await this.resetToDefaults();
        break;

      case 'open_logs':
        logger.show();
        break;
    }
  }

  private sync(): void {
    const settings = getSettings();
    const providers: ProviderOption[] = Object.values(PROVIDERS).map(p => ({
      name: p.name,
      displayName: p.displayName,
      isLocal: p.isLocal,
      requiresApiKey: p.requiresApiKey,
      envKeyVar: p.envKeyVar,
      envKeySet: !!(p.envKeyVar && process.env[p.envKeyVar]),
      defaultBaseUrl: p.defaultBaseUrl,
    }));

    this.post({ type: 'sync', settings, providers });
  }

  private async saveSettings(updates: Partial<SettingsState>): Promise<void> {
    const redactedKeys = new Set(['remoteApiKey', 'localApiKey']);
    logger.info('Save requested', {
      keys: Object.keys(updates),
      previews: Object.fromEntries(
        Object.entries(updates).map(([k, v]) => [k, redactedKeys.has(k) ? '[redacted]' : v]),
      ),
    });

    const saved: Partial<SettingsState> = {};
    const errors: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      try {
        // Re-acquire the configuration object before each write. VS Code
        // can invalidate the previous snapshot after an update.
        const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
        await cfg.update(key, value, vscode.ConfigurationTarget.Global);

        // Verify the write landed — workspace-level settings can mask
        // user-level writes, which is a common cause of "settings didn't
        // take effect" bugs.
        const readBack = vscode.workspace.getConfiguration(EXTENSION_ID).get(key);
        if (readBack !== value) {
          errors.push(
            `${key}: saved to user settings but an overriding value "${JSON.stringify(readBack)}" ` +
            `exists in workspace settings. Remove it from .vscode/settings.json or save to workspace scope.`,
          );
          logger.warn(`Setting "${key}" masked by workspace-level override`, { saved: value, effective: readBack });
          continue;
        }

        (saved as any)[key] = value;
        logger.info(`Setting saved: ${key} = ${redactedKeys.has(key) ? '[redacted]' : JSON.stringify(value)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${key}: ${msg}`);
        logger.error(`Failed to save setting "${key}"`, err);
      }
    }

    if (errors.length === 0) {
      this.post({
        type: 'save_result',
        success: true,
        message: `Saved ${Object.keys(saved).length} setting${Object.keys(saved).length !== 1 ? 's' : ''}.`,
        saved,
      });
    } else {
      this.post({
        type: 'save_result',
        success: false,
        message: `Some settings failed: ${errors.join('; ')}`,
        saved,
      });
    }
    // Note: we do NOT call sync() here. The webview merges `saved` into its
    // local state so the form doesn't reset. Global onDidChangeConfiguration
    // in extension.ts will debounce and recreate the agent in the background.
  }

  private async testConnection(
    target: 'local' | 'remote',
    overrides?: Partial<SettingsState>,
  ): Promise<void> {
    // Merge stored settings with any unsaved form values from the webview
    const settings = { ...getSettings(), ...(overrides || {}) };

    const providerName = target === 'local' ? settings.localProvider : settings.remoteProvider;
    const modelName = target === 'local' ? settings.localModel : settings.remoteModel;
    const apiKey = target === 'remote'
      ? resolveApiKey(providerName, settings.remoteApiKey)
      : resolveApiKey(providerName, settings.localApiKey);

    const meta = PROVIDERS[providerName];
    const rawBaseUrl = target === 'local'
      ? (settings.localBaseUrl || meta?.defaultBaseUrl)
      : undefined;
    const baseUrl = normalizeBaseUrl(providerName, rawBaseUrl);

    logger.info(`Testing ${target} connection`, {
      provider: providerName,
      model: modelName,
      baseUrl: baseUrl || '(default)',
      baseUrlRaw: rawBaseUrl,
      hasApiKey: !!apiKey,
    });

    try {
      if (!meta) {
        throw new Error(`Unknown provider: "${providerName}"`);
      }
      if (meta.requiresApiKey && !apiKey) {
        throw new Error(`Missing API key. Set ${meta.envKeyVar} env var or fill it in the API Key field.`);
      }
      if (!modelName) {
        throw new Error('Model name is empty.');
      }

      const config: Record<string, unknown> = { apiKey: apiKey || 'local' };
      if (baseUrl) config.baseUrl = baseUrl;

      const provider = await createProvider(providerName as ProviderName, config as any);

      // 10s timeout so a non-responsive server doesn't hang the UI forever
      const response = await withTimeout(
        provider.chat({
          model: modelName,
          messages: [{ role: 'user', content: 'Reply with the single word "ok".' }],
          max_tokens: 16,
        }),
        10_000,
        `Timed out after 10 seconds connecting to ${baseUrl || providerName}.`,
      );

      const text = response.choices?.[0]?.message?.content ?? '';

      const normalizedNote = baseUrl && rawBaseUrl && baseUrl !== rawBaseUrl
        ? ` (base URL normalized to ${baseUrl})`
        : '';

      logger.info(`Connection test succeeded for ${providerName}: "${String(text).slice(0, 60)}"`);
      this.post({
        type: 'connection_test',
        target,
        success: true,
        message: `Connected${normalizedNote}. Response: "${String(text).slice(0, 40)}"`,
      });
    } catch (err) {
      const rawMessage = getErrorMessage(err);
      // Decorate with provider/model context so the user knows where the failure came from
      let message = rawMessage;

      // Common error pattern: 404/not found from LM Studio/Ollama missing /v1
      if (/404|not\s*found/i.test(rawMessage) && (providerName === 'lmstudio' || providerName === 'ollama')) {
        message += `\n\nTip: LM Studio and Ollama expect the OpenAI-compatible API under /v1. Try setting Base URL to "${rawBaseUrl}/v1" or leaving it blank to use the default.`;
      } else if (/ECONNREFUSED|fetch failed|network/i.test(rawMessage)) {
        message += `\n\nCan't reach the server. Check the URL and that the service is running.`;
      } else if (/401|unauthorized|invalid.*key/i.test(rawMessage)) {
        message += `\n\nAPI key was rejected. Double-check it's correct and has the right permissions.`;
      } else if (/model.*not.*found|no such model/i.test(rawMessage)) {
        message += `\n\nThe model "${modelName}" isn't available. Check the model name.`;
      }

      logger.warn(`Connection test failed for ${providerName}`, { error: rawMessage, target });
      this.post({
        type: 'connection_test',
        target,
        success: false,
        message,
      });
    }
  }

  private async resetToDefaults(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
    const keys: (keyof SettingsState)[] = [
      'localProvider', 'localModel', 'localBaseUrl',
      'remoteProvider', 'remoteModel', 'remoteApiKey', 'remoteBaseUrl',
      'permissionMode', 'maxIterations', 'maxContextTokens',
      'triageEnabled', 'autoCompact', 'autoCompactThreshold',
      'instructionFile',
    ];
    for (const key of keys) {
      await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    logger.info('Settings reset to defaults');
    this.sync();
  }

  private post(msg: SettingsExtToWebview): void {
    this.panel.webview.postMessage(msg);
  }

  public dispose(): void {
    SettingsPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      x?.dispose();
    }
  }

  private _getHtml(extensionUri: vscode.Uri): string {
    const distUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist');
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'settings.js')
    );
    const sharedUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'main.js')
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'main.css')
    );
    const nonce = getNonce();
    const csp = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      style-src ${csp} 'unsafe-inline';
      script-src 'nonce-${nonce}' ${csp};
      img-src ${csp} blob: data:;
      font-src ${csp};">
  <link rel="stylesheet" href="${styleUri}">
  <link rel="modulepreload" href="${sharedUri}">
  <title>Clodcode Settings</title>
</head>
<body>
  <div id="settings-root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}
