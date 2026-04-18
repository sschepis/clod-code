import React, { useEffect, useState, useCallback } from 'react';
import {
  Save, RotateCcw, ScrollText, CheckCircle2, XCircle,
  Loader2, Cpu, Globe, Key, Shield, Sliders, Eye, EyeOff, AlertTriangle,
} from 'lucide-react';
import type {
  SettingsState, ProviderOption,
  SettingsExtToWebview, SettingsWebviewToExt,
} from '../../src/shared/message-types';

// Duplicated from src/config/model-inference.ts — we can't cross-import
// between extension-host and webview bundles.
const MODEL_PATTERNS: Array<[RegExp, string]> = [
  [/^claude[-_]/i, 'anthropic'],
  [/^(gpt[-_]|o1[-_]?|o3[-_]?|chatgpt[-_])/i, 'openai'],
  [/^gemini[-_]/i, 'gemini'],
  [/^deepseek[-_]/i, 'deepseek'],
  [/^(llama|qwen|mistral|mixtral|phi|codellama|starcoder|deepseek-coder|gemma|yi)/i, 'ollama'],
];

function inferProviderFromModel(model: string): string | null {
  if (!model) return null;
  for (const [pattern, provider] of MODEL_PATTERNS) {
    if (pattern.test(model)) return provider;
  }
  return null;
}

function isModelCompatibleWithProvider(model: string, provider: string): boolean {
  const inferred = inferProviderFromModel(model);
  if (inferred === null) return true;
  if (provider === 'vertex-gemini' && inferred === 'gemini') return true;
  if (provider === 'vertex-anthropic' && inferred === 'anthropic') return true;
  if (provider === 'openrouter') return true;
  if ((provider === 'ollama' || provider === 'lmstudio') && inferred === 'ollama') return true;
  return inferred === provider;
}

const PROVIDER_MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
  'vertex-gemini': ['gemini-2.0-flash', 'gemini-1.5-pro'],
  'vertex-anthropic': ['claude-sonnet-4@20250514', 'claude-opus-4@20250514'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  openrouter: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.0-flash'],
  ollama: ['llama3:8b', 'llama3.1:8b', 'qwen2.5-coder:7b'],
  lmstudio: ['llama-3.1-8b-instruct', 'qwen2.5-coder-7b-instruct'],
};

function getDefaultModelForProvider(provider: string): string {
  return PROVIDER_MODEL_SUGGESTIONS[provider]?.[0] ?? '';
}

declare function acquireVsCodeApi(): {
  postMessage(msg: SettingsWebviewToExt): void;
};

const vscode = (() => {
  if (typeof acquireVsCodeApi === 'function') return acquireVsCodeApi();
  return { postMessage: (m: any) => console.log('[mock]', m) };
})();

const PERMISSION_MODES = [
  { value: 'readonly', label: 'Read-only', description: 'Only allow reading files and search. No writes or shell commands.' },
  { value: 'workspace-write', label: 'Workspace write', description: 'Allow file edits but not shell commands or git operations.' },
  { value: 'full-access', label: 'Full access', description: 'Allow all tools including shell commands. Use with caution.' },
  { value: 'prompt', label: 'Prompt (recommended)', description: 'Ask before each potentially dangerous operation.' },
];

interface TestResult {
  success: boolean;
  message: string;
  timestamp: number;
}

export default function SettingsApp() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [draft, setDraft] = useState<Partial<SettingsState>>({});
  const [saveStatus, setSaveStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [localTest, setLocalTest] = useState<TestResult | null>(null);
  const [remoteTest, setRemoteTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState<{ local?: boolean; remote?: boolean }>({});
  const [showRemoteApiKey, setShowRemoteApiKey] = useState(false);
  const [showLocalApiKey, setShowLocalApiKey] = useState(false);

  // Listen for messages from extension host
  useEffect(() => {
    const listener = (e: MessageEvent<SettingsExtToWebview>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'sync':
          setSettings(msg.settings);
          setProviders(msg.providers);
          setDraft({});
          break;
        case 'save_result': {
          setSaveStatus({ success: msg.success, message: msg.message });
          setTimeout(() => setSaveStatus(null), 4000);
          // Merge successfully saved keys into local settings and remove
          // them from the draft so the form reflects authoritative state
          // without a full re-sync (which would wipe any pending edits).
          const saved = msg.saved || {};
          if (Object.keys(saved).length > 0) {
            setSettings(prev => prev ? { ...prev, ...saved } : prev);
            setDraft(prev => {
              const next = { ...prev };
              for (const key of Object.keys(saved)) {
                delete (next as any)[key];
              }
              return next;
            });
          }
          break;
        }
        case 'connection_test': {
          const result: TestResult = { success: msg.success, message: msg.message, timestamp: Date.now() };
          if (msg.target === 'local') {
            setLocalTest(result);
            setTesting(t => ({ ...t, local: false }));
          } else {
            setRemoteTest(result);
            setTesting(t => ({ ...t, remote: false }));
          }
          break;
        }
      }
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);

  const value = useCallback(<K extends keyof SettingsState>(key: K): SettingsState[K] => {
    return (draft[key] !== undefined ? draft[key] : settings?.[key]) as SettingsState[K];
  }, [draft, settings]);

  const update = useCallback(<K extends keyof SettingsState>(key: K, val: SettingsState[K]) => {
    setDraft(d => ({ ...d, [key]: val }));
  }, []);

  /**
   * When the user switches providers, if the current model doesn't match
   * the new provider, offer to replace it with a sensible default.
   * This prevents the classic "provider=anthropic but model=gemini-*" footgun.
   */
  const updateProviderWithModelSync = useCallback((
    providerKey: 'localProvider' | 'remoteProvider',
    modelKey: 'localModel' | 'remoteModel',
    newProvider: string,
  ) => {
    setDraft(d => {
      const next = { ...d, [providerKey]: newProvider };
      // Get the current model (from draft or settings)
      const currentModel = (d[modelKey] ?? settings?.[modelKey] ?? '') as string;
      if (currentModel && !isModelCompatibleWithProvider(currentModel, newProvider)) {
        const suggested = getDefaultModelForProvider(newProvider);
        if (suggested) {
          (next as any)[modelKey] = suggested;
        }
      } else if (!currentModel) {
        const suggested = getDefaultModelForProvider(newProvider);
        if (suggested) {
          (next as any)[modelKey] = suggested;
        }
      }
      return next;
    });
  }, [settings]);

  const handleSave = () => {
    if (Object.keys(draft).length === 0) return;
    vscode.postMessage({ type: 'save', settings: draft });
  };

  const handleReset = () => {
    if (!confirm('Reset all settings to defaults? This will clear API keys.')) return;
    vscode.postMessage({ type: 'reset_to_defaults' });
  };

  const handleTest = (target: 'local' | 'remote') => {
    setTesting(t => ({ ...t, [target]: true }));
    if (target === 'local') setLocalTest(null);
    else setRemoteTest(null);
    // Send current draft so the user can test their unsaved changes
    vscode.postMessage({ type: 'test_connection', target, overrides: draft });
  };

  const handleOpenLogs = () => {
    vscode.postMessage({ type: 'open_logs' });
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-screen text-zinc-500">
        <Loader2 className="animate-spin" size={20} />
        <span className="ml-2">Loading settings...</span>
      </div>
    );
  }

  const hasChanges = Object.keys(draft).length > 0;
  const localProvider = providers.find(p => p.name === value('localProvider'));
  const remoteProvider = providers.find(p => p.name === value('remoteProvider'));

  return (
    <div className="h-screen flex flex-col bg-[#121214] text-zinc-200 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Sliders size={18} className="text-indigo-400" />
            Clodcode Settings
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">Configure LLM providers, permissions, and behavior</p>
        </div>
        <button
          onClick={handleOpenLogs}
          className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-700 transition-colors"
        >
          <ScrollText size={14} /> View Logs
        </button>
      </header>

      {/* Scrollable main content */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}
      >
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-8">

        {/* Remote Provider Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Remote Provider</h2>
            <span className="text-xs text-zinc-500">(powerful model for complex tasks)</span>
          </div>

          <Field label="Provider">
            <select
              value={value('remoteProvider')}
              onChange={e => updateProviderWithModelSync('remoteProvider', 'remoteModel', e.target.value)}
              className="select"
            >
              {providers.filter(p => !p.isLocal || p.name === 'ollama' || p.name === 'lmstudio').map(p => (
                <option key={p.name} value={p.name}>{p.displayName}</option>
              ))}
            </select>
            {remoteProvider?.requiresApiKey && (
              <div className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5">
                <Key size={12} />
                Requires API key. Env var: <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400">{remoteProvider.envKeyVar}</code>
                {remoteProvider.envKeySet && <span className="text-emerald-500">✓ env var detected</span>}
              </div>
            )}
          </Field>

          <Field label="Model">
            <input
              type="text"
              list="remote-model-suggestions"
              value={value('remoteModel') || ''}
              onChange={e => update('remoteModel', e.target.value)}
              placeholder={getDefaultModelForProvider(value('remoteProvider') || 'anthropic')}
              className="input"
            />
            <datalist id="remote-model-suggestions">
              {(PROVIDER_MODEL_SUGGESTIONS[value('remoteProvider') || 'anthropic'] || []).map(m => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {value('remoteModel') && !isModelCompatibleWithProvider(value('remoteModel'), value('remoteProvider')) && (
              <div className="mt-2 p-2 bg-red-900/30 border border-red-800/50 rounded text-xs text-red-200 flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">Model / provider mismatch</div>
                  <div className="mt-0.5">
                    "{value('remoteModel')}" looks like a{' '}
                    <strong className="text-red-100">
                      {providers.find(p => p.name === inferProviderFromModel(value('remoteModel')))?.displayName ?? inferProviderFromModel(value('remoteModel'))}
                    </strong>{' '}
                    model, but the selected provider is{' '}
                    <strong className="text-red-100">{remoteProvider?.displayName}</strong>.
                    The agent will fail to start. Change one of them.
                  </div>
                </div>
              </div>
            )}
          </Field>

          {remoteProvider?.requiresApiKey && (
            <Field label="API Key">
              <div className="relative">
                <input
                  type={showRemoteApiKey ? 'text' : 'password'}
                  value={value('remoteApiKey') || ''}
                  onChange={e => update('remoteApiKey', e.target.value)}
                  placeholder={remoteProvider.envKeySet ? `Using ${remoteProvider.envKeyVar} env var` : 'Paste your API key'}
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowRemoteApiKey(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
                >
                  {showRemoteApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-1.5">
                Stored in VS Code settings. Env var ({remoteProvider.envKeyVar}) takes precedence if set.
              </p>
            </Field>
          )}

          <TestButton
            label="Test remote connection"
            onClick={() => handleTest('remote')}
            testing={!!testing.remote}
            result={remoteTest}
          />
        </section>

        {/* Local Provider Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Local Provider</h2>
            <span className="text-xs text-zinc-500">(fast triage model)</span>
          </div>

          <Field label="Provider">
            <select
              value={value('localProvider')}
              onChange={e => updateProviderWithModelSync('localProvider', 'localModel', e.target.value)}
              className="select"
            >
              {providers.map(p => (
                <option key={p.name} value={p.name}>{p.displayName}</option>
              ))}
            </select>
          </Field>

          <Field label="Model">
            <input
              type="text"
              list="local-model-suggestions"
              value={value('localModel') || ''}
              onChange={e => update('localModel', e.target.value)}
              placeholder={getDefaultModelForProvider(value('localProvider') || 'ollama')}
              className="input"
            />
            <datalist id="local-model-suggestions">
              {(PROVIDER_MODEL_SUGGESTIONS[value('localProvider') || 'ollama'] || []).map(m => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {value('localModel') && !isModelCompatibleWithProvider(value('localModel'), value('localProvider')) && (
              <div className="mt-2 p-2 bg-amber-900/30 border border-amber-800/50 rounded text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <span>
                  "{value('localModel')}" looks unusual for {localProvider?.displayName}.
                  Pick a suggested model above, or confirm this is what you want.
                </span>
              </div>
            )}
          </Field>

          {localProvider?.isLocal && (
            <Field label="Base URL">
              <input
                type="text"
                value={value('localBaseUrl') || ''}
                onChange={e => update('localBaseUrl', e.target.value)}
                placeholder={localProvider.defaultBaseUrl}
                className="input"
              />
              {(() => {
                const url = (value('localBaseUrl') || '').trim();
                if (!url) return null;
                // Try to detect missing /v1 for OpenAI-compatible local servers
                let hasPath = false;
                try {
                  const parsed = new URL(url);
                  hasPath = Boolean(parsed.pathname && parsed.pathname !== '/');
                } catch { return null; }
                if (!hasPath) {
                  return (
                    <div className="mt-2 p-2 bg-amber-900/30 border border-amber-800/50 rounded text-xs text-amber-200 flex items-start gap-2">
                      <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <span>
                        {localProvider.displayName} expects the OpenAI-compatible API under <code className="bg-zinc-900 px-1 rounded">/v1</code>.
                        Clodcode will automatically use <code className="bg-zinc-900 px-1 rounded">{url.replace(/\/+$/, '')}/v1</code>.
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
            </Field>
          )}

          {/* API Key field for commercial local providers */}
          {localProvider?.requiresApiKey && (
            <Field label="API Key">
              <div className="relative">
                <input
                  type={showLocalApiKey ? 'text' : 'password'}
                  value={value('localApiKey') || ''}
                  onChange={e => update('localApiKey', e.target.value)}
                  placeholder={localProvider.envKeySet ? `Using ${localProvider.envKeyVar} env var` : 'Paste your API key'}
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowLocalApiKey(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
                >
                  {showLocalApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5">
                <Key size={12} />
                Requires API key. Env var: <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400">{localProvider.envKeyVar}</code>
                {localProvider.envKeySet && <span className="text-emerald-500">✓ env var detected</span>}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                Stored in VS Code settings. Env var takes precedence if set.
              </p>
            </Field>
          )}

          <Field label="">
            <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={value('triageEnabled') ?? true}
                onChange={e => update('triageEnabled', e.target.checked)}
                className="checkbox mt-0.5"
              />
              <span>
                <span className="font-medium">Enable dual-LLM triage</span>
                <div className="text-xs text-zinc-500 mt-0.5 font-normal">
                  Use the local model to classify whether a query needs the remote model.
                  Saves cost, but requires a local model that can reliably produce structured JSON
                  (e.g. Llama 3.1, Qwen 2.5, Mistral). If triage keeps failing, <strong>turn this off</strong> —
                  Clodcode will route everything through the remote model instead.
                </div>
              </span>
            </label>
          </Field>

          {value('triageEnabled') === false && (
            <div className="mt-2 p-2 bg-blue-900/30 border border-blue-800/50 rounded text-xs text-blue-200 flex items-start gap-2">
              <span>
                <strong>Triage disabled:</strong> Local provider settings above are ignored.
                Everything runs through your remote provider (shown in the Remote Provider section).
              </span>
            </div>
          )}

          <TestButton
            label="Test local connection"
            onClick={() => handleTest('local')}
            testing={!!testing.local}
            result={localTest}
          />
        </section>

        {/* Permissions Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Permissions</h2>
          </div>

          <Field label="Permission mode">
            <div className="space-y-2">
              {PERMISSION_MODES.map(mode => (
                <label
                  key={mode.value}
                  className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    value('permissionMode') === mode.value
                      ? 'bg-indigo-500/10 border-indigo-500/40'
                      : 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-900/60'
                  }`}
                >
                  <input
                    type="radio"
                    name="permissionMode"
                    value={mode.value}
                    checked={value('permissionMode') === mode.value}
                    onChange={() => update('permissionMode', mode.value as any)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-zinc-200">{mode.label}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">{mode.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        </section>

        {/* Behavior Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Sliders size={16} className="text-cyan-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Behavior</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Max iterations per turn">
              <input
                type="number"
                value={value('maxIterations') ?? 25}
                onChange={e => update('maxIterations', parseInt(e.target.value, 10) || 25)}
                min={1}
                max={100}
                className="input"
              />
            </Field>

            <Field label="Max context tokens">
              <input
                type="number"
                value={value('maxContextTokens') ?? 128000}
                onChange={e => update('maxContextTokens', parseInt(e.target.value, 10) || 128000)}
                min={4096}
                step={1024}
                className="input"
              />
            </Field>
          </div>

          <Field label="">
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={value('autoCompact') ?? true}
                onChange={e => update('autoCompact', e.target.checked)}
                className="checkbox"
              />
              Automatically compact session when token limit approaches
            </label>
          </Field>

          {value('autoCompact') && (
            <Field label="Auto-compact threshold (tokens)">
              <input
                type="number"
                value={value('autoCompactThreshold') ?? 150000}
                onChange={e => update('autoCompactThreshold', parseInt(e.target.value, 10) || 150000)}
                min={4096}
                step={1024}
                className="input"
              />
            </Field>
          )}

          <Field label="Instruction file name">
            <input
              type="text"
              value={value('instructionFile') || 'CLAUDE.md'}
              onChange={e => update('instructionFile', e.target.value)}
              placeholder="CLAUDE.md"
              className="input"
            />
            <p className="text-xs text-zinc-500 mt-1.5">
              File names searched up the directory tree to load project-specific instructions.
            </p>
          </Field>
        </section>
        </div>
      </div>

      {/* Action bar (flex child, not fixed-positioned, so content area scrolls freely) */}
      <div className="flex-shrink-0 bg-zinc-950 border-t border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          {saveStatus && (
            <div className={`flex items-center gap-1.5 ${saveStatus.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {saveStatus.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>{saveStatus.message}</span>
            </div>
          )}
          {hasChanges && !saveStatus && (
            <span className="text-amber-400">{Object.keys(draft).length} unsaved change{Object.keys(draft).length !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors flex items-center gap-1.5"
          >
            <RotateCcw size={14} /> Reset to defaults
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`px-4 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
              hasChanges
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            <Save size={14} /> Save changes
          </button>
        </div>
      </div>

      {/* Inline styles to avoid depending on Tailwind for form elements */}
      <style>{`
        .input, .select {
          width: 100%;
          padding: 0.5rem 0.75rem;
          background: #18181b;
          border: 1px solid #3f3f46;
          color: #e4e4e7;
          border-radius: 0.375rem;
          font-size: 0.85rem;
          font-family: inherit;
          transition: border-color 0.15s;
        }
        .input:focus, .select:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 1px #6366f1;
        }
        .checkbox {
          width: 1rem;
          height: 1rem;
          accent-color: #6366f1;
        }
      `}</style>
    </div>
  );
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    {label && <label className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</label>}
    {children}
  </div>
);

interface TestButtonProps {
  label: string;
  onClick: () => void;
  testing: boolean;
  result: TestResult | null;
}

const TestButton: React.FC<TestButtonProps> = ({ label, onClick, testing, result }) => (
  <div className="flex items-center gap-3">
    <button
      onClick={onClick}
      disabled={testing}
      className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors flex items-center gap-1.5 disabled:opacity-50"
    >
      {testing ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
      {testing ? 'Testing...' : label}
    </button>
    {result && (
      <span className={`text-xs flex items-center gap-1.5 ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
        {result.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
        {result.message}
      </span>
    )}
  </div>
);
