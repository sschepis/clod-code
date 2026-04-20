import * as vscode from 'vscode';
import { createProvider, type ProviderName } from '@sschepis/llm-wrapper';
import { EXTENSION_ID } from '../shared/constants';
import type {
  SettingsExtToWebview, SettingsWebviewToExt,
  SettingsState, ProviderOption,
} from '../shared/message-types';
import { PROVIDERS, getProviderMeta, normalizeBaseUrl } from '../config/provider-registry';
import { listModelsForProvider, listOllamaModels, isOllamaRunning, pullOllamaModel } from '../config/model-listing';
import { MANAGED_PROVIDER_ID, getManagedProviderStatus, ensureManagedProvider, RECOMMENDED_MANAGED_MODELS } from '../config/managed-provider';
import { ENV_KEY_MAP } from '../shared/constants';
import { getSettings } from '../config/settings';
import { logger } from '../shared/logger';
import { getErrorMessage } from '../shared/errors';

export class SettingsPanel {
  public static readonly viewType = 'obotovs.settingsPanel';
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
      'Oboto Settings',
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
        await this.testConnection(msg.providerId, msg.model);
        break;

      case 'pull_model':
        await this.pullModel(msg.model);
        break;

      case 'reset_to_defaults':
        await this.resetToDefaults();
        break;

      case 'open_logs':
        logger.show();
        break;
    }
  }

  private async sync(): Promise<void> {
    const settings = getSettings();
    const providers = await this.buildProviderList(settings);
    this.post({ type: 'sync', settings, providers });

    const managed = providers.find(p => p.managed);
    if (managed && !managed.serviceRunning) {
      this.autoProvisionManaged();
    }
  }

  private autoProvisioningInProgress = false;

  private async autoProvisionManaged(): Promise<void> {
    if (this.autoProvisioningInProgress) return;
    this.autoProvisioningInProgress = true;
    try {
      await ensureManagedProvider();
    } catch (err) {
      logger.warn('Auto-provision of managed provider failed', err);
    } finally {
      this.autoProvisioningInProgress = false;
      const settings = getSettings();
      const providers = await this.buildProviderList(settings);
      this.post({ type: 'sync', settings, providers });
    }
  }

  private async buildProviderList(settings: typeof import('../config/settings').getSettings extends () => infer R ? R : never): Promise<ProviderOption[]> {
    const result: ProviderOption[] = [];

    // 1. Managed Oboto provider (always first)
    const managedStatus = await getManagedProviderStatus();
    result.push({
      id: MANAGED_PROVIDER_ID,
      type: 'ollama',
      displayName: 'Oboto Local',
      isLocal: true,
      requiresApiKey: false,
      envKeyVar: '',
      envKeySet: false,
      managed: true,
      models: Array.from(new Set([...managedStatus.availableModels, ...RECOMMENDED_MANAGED_MODELS])),
      serviceRunning: managedStatus.ollamaRunning,
    });

    // 2. User-configured providers (fetch models from each API in parallel)
    const providerEntries = Object.entries(settings.providers);
    const modelFetches = providerEntries.map(async ([, config]) => {
      const meta = getProviderMeta(config.type);
      const apiKey = config.apiKey?.trim()
        || (ENV_KEY_MAP[config.type] ? process.env[ENV_KEY_MAP[config.type]] : '')
        || '';
      try {
        return await listModelsForProvider(config.type, apiKey, config.baseUrl || meta?.defaultBaseUrl);
      } catch (err) {
        logger.debug(`Model list fetch failed for ${config.type}`, err);
        return [];
      }
    });
    const allModels = await Promise.all(modelFetches);

    for (let i = 0; i < providerEntries.length; i++) {
      const [id, config] = providerEntries[i];
      const meta = getProviderMeta(config.type);
      const models = allModels[i];

      const envVar = ENV_KEY_MAP[config.type] || '';
      result.push({
        id,
        type: config.type,
        displayName: config.label || meta?.displayName || config.type,
        isLocal: meta?.isLocal ?? false,
        requiresApiKey: meta?.requiresApiKey ?? false,
        envKeyVar: envVar,
        envKeySet: !!(envVar && process.env[envVar]),
        managed: false,
        models,
      });
    }

    return result;
  }

  private async saveSettings(updates: Partial<SettingsState>): Promise<void> {
    const redactedKeys = new Set(['providers']);
    logger.info('Save requested', { keys: Object.keys(updates) });

    const saved: Partial<SettingsState> = {};
    const errors: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      try {
        const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
        await cfg.update(key, value, vscode.ConfigurationTarget.Global);

        const readBack = vscode.workspace.getConfiguration(EXTENSION_ID).get(key);
        if (JSON.stringify(readBack) !== JSON.stringify(value)) {
          errors.push(
            `${key}: saved to user settings but an overriding value exists in workspace settings.`,
          );
          logger.warn(`Setting "${key}" masked by workspace-level override`);
          continue;
        }

        (saved as any)[key] = value;
        logger.info(`Setting saved: ${key}`);
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
  }

  private async testConnection(providerId: string, modelName: string): Promise<void> {
    try {
      if (providerId === MANAGED_PROVIDER_ID) {
        await this.testManagedProvider(modelName);
        return;
      }

      const settings = getSettings();
      const providerConfig = settings.providers[providerId];
      if (!providerConfig) {
        throw new Error(`Provider "${providerId}" not found in settings.`);
      }

      const meta = getProviderMeta(providerConfig.type);
      if (!meta) {
        throw new Error(`Unknown provider type "${providerConfig.type}".`);
      }

      const apiKey = providerConfig.apiKey?.trim()
        || (ENV_KEY_MAP[providerConfig.type] ? process.env[ENV_KEY_MAP[providerConfig.type]] : '')
        || '';

      if (meta.requiresApiKey && !apiKey) {
        throw new Error(
          `No API key found. Set ${ENV_KEY_MAP[providerConfig.type] || 'the API key'} in your environment or paste it in the API Key field and save.`,
        );
      }
      if (providerConfig.type.startsWith('vertex-')) {
        const { execSync } = require('child_process');
        try {
          execSync('gcloud auth print-access-token', { stdio: 'ignore' });
        } catch {
          throw new Error('Not logged into gcloud. Please run `gcloud auth login` and `gcloud auth application-default login` in your terminal first.');
        }
      }

      // If no model was selected, try to fetch the list and pick the first one
      let model = modelName;
      if (!model) {
        try {
          const models = await listModelsForProvider(providerConfig.type, apiKey, providerConfig.baseUrl || meta.defaultBaseUrl);
          model = providerConfig.defaultModel || models[0] || '';
        } catch { /* fall through */ }
      }
      if (!model) {
        if (providerConfig.type.startsWith('vertex-')) {
          throw new Error('No model available. Ensure you are logged into Google Cloud via \'gcloud auth login\' and \'gcloud config set project <your-project>\'.');
        } else if (providerConfig.type === 'vscode-lm') {
          throw new Error('No model available. Ensure you have a GitHub Copilot or other VS Code language model extension installed.');
        } else {
          throw new Error('No model available. Save your API key first, then reopen settings to load the model list.');
        }
      }

      const config: Record<string, unknown> = { apiKey: apiKey || 'local' };
      const baseUrl = normalizeBaseUrl(providerConfig.type, providerConfig.baseUrl || meta.defaultBaseUrl);
      if (baseUrl) config.baseUrl = baseUrl;

      const provider = await createProvider(providerConfig.type as ProviderName, config as any);

      const response = await withTimeout(
        provider.chat({
          model,
          messages: [{ role: 'user', content: 'Reply with the single word "ok".' }],
          max_tokens: 16,
        }),
        30_000,
        `Timed out after 30 seconds — the provider may be slow or unreachable.`,
      );

      const text = String(response.choices?.[0]?.message?.content ?? '').trim();
      logger.info(`Connection test succeeded for ${providerId} (${model}): "${String(text).slice(0, 60)}"`);
      this.post({
        type: 'connection_test',
        providerId,
        success: true,
        message: text ? `${model}: "${text.slice(0, 40)}"` : `${model}: connected (empty response)`,
      });
    } catch (err) {
      const message = getErrorMessage(err);
      logger.warn(`Connection test failed for ${providerId} (model=${modelName})`, err ?? '(no error detail)');
      this.post({
        type: 'connection_test',
        providerId,
        success: false,
        message: message !== 'Unknown error' ? message : `Connection failed for ${modelName || 'unknown model'} — check provider configuration`,
      });
    }
  }

  private async testManagedProvider(modelName: string): Promise<void> {
    if (!modelName) {
      this.post({
        type: 'connection_test',
        providerId: MANAGED_PROVIDER_ID,
        success: false,
        message: 'No model selected. Pull a model first.',
      });
      return;
    }

    try {
      await ensureManagedProvider(modelName);
    } catch (err) {
      this.post({
        type: 'connection_test',
        providerId: MANAGED_PROVIDER_ID,
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const baseUrl = normalizeBaseUrl('ollama', 'http://localhost:11434');

    try {
      const config: Record<string, unknown> = { apiKey: 'local' };
      if (baseUrl) config.baseUrl = baseUrl;

      const provider = await createProvider('ollama' as ProviderName, config as any);
      const response = await withTimeout(
        provider.chat({
          model: modelName,
          messages: [{ role: 'user', content: 'Reply with the single word "ok".' }],
          max_tokens: 16,
        }),
        30_000,
        `Timed out after 30 seconds — is ${modelName} loaded?`,
      );

      const text = String(response.choices?.[0]?.message?.content ?? '').trim();
      this.post({
        type: 'connection_test',
        providerId: MANAGED_PROVIDER_ID,
        success: true,
        message: text ? `${modelName}: "${text.slice(0, 40)}"` : `${modelName}: connected`,
      });
    } catch (err) {
      const detail = getErrorMessage(err);
      logger.warn(`Managed provider test failed: model=${modelName} baseUrl=${baseUrl}`, err);
      this.post({
        type: 'connection_test',
        providerId: MANAGED_PROVIDER_ID,
        success: false,
        message: detail !== 'Unknown error'
          ? `${modelName}: ${detail}`
          : `${modelName}: connection failed — verify Ollama is running on ${baseUrl} and the model is pulled`,
      });
    }
  }

  private async pullModel(modelName: string): Promise<void> {
    try {
      this.post({ type: 'model_pull_progress', model: modelName, status: 'Ensuring Ollama is ready...' });

      await ensureManagedProvider();

      this.post({ type: 'model_pull_progress', model: modelName, status: 'Starting download...' });

      await pullOllamaModel(
        modelName,
        (status, pct) => {
          this.post({ type: 'model_pull_progress', model: modelName, status, percent: pct });
        },
      );

      this.post({ type: 'model_pull_complete', model: modelName, success: true });
      await this.sync();
    } catch (err) {
      this.post({ type: 'model_pull_complete', model: modelName, success: false, error: getErrorMessage(err) });
    }
  }

  private async resetToDefaults(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
    const keys: (keyof SettingsState)[] = [
      'providers', 'routing', 'triageEnabled',
      'permissionMode', 'maxIterations', 'maxContextTokens',
      'autoCompact', 'autoCompactThreshold', 'instructionFile', 'shell',
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
  <title>Oboto Settings</title>
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
