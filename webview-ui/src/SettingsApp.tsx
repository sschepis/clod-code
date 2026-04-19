import React, { useEffect, useState, useCallback } from 'react';
import {
  Save, RotateCcw, ScrollText, CheckCircle2, XCircle,
  Loader2, Cpu, Globe, Key, Shield, Sliders, Eye, EyeOff, Download,
  Plus, Trash2, ArrowRight, Terminal,
} from 'lucide-react';
import type {
  SettingsState, ProviderOption, SettingsProviderConfig, SettingsRouteAssignment,
  SettingsExtToWebview, SettingsWebviewToExt,
} from '../../src/shared/message-types';

const PROVIDER_TYPES = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'vertex-gemini', label: 'Vertex AI (Gemini)' },
  { value: 'vertex-anthropic', label: 'Vertex AI (Anthropic)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'azure-openai', label: 'Azure OpenAI' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'lmstudio', label: 'LM Studio' },
];

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

const ROUTING_ROLES = [
  { key: 'triage' as const, label: 'Triage', description: 'Quick classification — a fast, cheap model works well' },
  { key: 'executor' as const, label: 'Executor', description: 'Main task execution — the workhorse model' },
  { key: 'planner' as const, label: 'Planner', description: 'Planning and architecture' },
  { key: 'summarizer' as const, label: 'Summarizer', description: 'Compaction and summarization' },
];

interface TestResult {
  success: boolean;
  message: string;
  timestamp: number;
}

export default function SettingsApp() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [draft, setDraft] = useState<Partial<SettingsState>>({});
  const [saveStatus, setSaveStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [showApiKeys, setShowApiKeys] = useState<Set<string>>(new Set());
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProviderType, setNewProviderType] = useState('anthropic');

  useEffect(() => {
    const listener = (e: MessageEvent<SettingsExtToWebview>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'sync':
          setSettings(msg.settings);
          setProviderOptions(msg.providers);
          setDraft({});
          break;
        case 'save_result': {
          setSaveStatus({ success: msg.success, message: msg.message });
          setTimeout(() => setSaveStatus(null), 4000);
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
          setTestResults(prev => ({ ...prev, [msg.providerId]: result }));
          setTestingIds(prev => { const next = new Set(prev); next.delete(msg.providerId); return next; });
          break;
        }
        case 'model_pull_progress':
          setPulling(true);
          setPullStatus(msg.status);
          setPullError(null);
          break;
        case 'model_pull_complete':
          setPulling(false);
          setPullStatus(null);
          if (!msg.success) setPullError(msg.error ?? 'Pull failed');
          else setPullError(null);
          break;
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

  const currentProviders = (): Record<string, SettingsProviderConfig> => {
    return (draft.providers ?? settings?.providers ?? {}) as Record<string, SettingsProviderConfig>;
  };

  const currentRouting = (): Partial<Record<'triage' | 'executor' | 'planner' | 'summarizer', SettingsRouteAssignment>> => {
    return (draft.routing ?? settings?.routing ?? {}) as any;
  };

  const updateProvider = (id: string, config: SettingsProviderConfig) => {
    const providers = { ...currentProviders(), [id]: config };
    update('providers', providers);
  };

  const removeProvider = (id: string) => {
    const providers = { ...currentProviders() };
    delete providers[id];
    update('providers', providers);
    const routing = { ...currentRouting() };
    for (const [role, assignment] of Object.entries(routing)) {
      if (assignment?.providerId === id) {
        delete (routing as any)[role];
      }
    }
    update('routing', routing);
  };

  const addProvider = () => {
    const providers = currentProviders();
    const typeLabel = PROVIDER_TYPES.find(t => t.value === newProviderType)?.label ?? newProviderType;
    let id = newProviderType;
    let counter = 2;
    while (providers[id]) {
      id = `${newProviderType}-${counter++}`;
    }
    updateProvider(id, { type: newProviderType, label: typeLabel });
    setAddingProvider(false);
    setNewProviderType('anthropic');
  };

  const updateRoute = (role: string, assignment: SettingsRouteAssignment | undefined) => {
    const routing = { ...currentRouting() };
    if (assignment) {
      (routing as any)[role] = assignment;
    } else {
      delete (routing as any)[role];
    }
    update('routing', routing);
  };

  const handleSave = () => {
    if (Object.keys(draft).length === 0) return;
    vscode.postMessage({ type: 'save', settings: draft });
  };

  const handleReset = () => {
    if (!confirm('Reset all settings to defaults? This will clear API keys and provider configurations.')) return;
    vscode.postMessage({ type: 'reset_to_defaults' });
  };

  const handleTest = (providerId: string, model: string) => {
    setTestingIds(prev => new Set(prev).add(providerId));
    setTestResults(prev => { const next = { ...prev }; delete next[providerId]; return next; });
    vscode.postMessage({ type: 'test_connection', providerId, model });
  };

  const handlePullModel = (model: string) => {
    if (!model) return;
    setPulling(true);
    setPullStatus('Starting...');
    setPullError(null);
    vscode.postMessage({ type: 'pull_model', model });
  };

  const handleOpenLogs = () => {
    vscode.postMessage({ type: 'open_logs' });
  };

  const toggleApiKeyVisibility = (id: string) => {
    setShowApiKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
  const providers = currentProviders();
  const routing = currentRouting();

  const allProviderChoices: Array<{ id: string; label: string }> = [
    { id: 'oboto', label: 'Oboto Local' },
    ...Object.entries(providers).map(([id, cfg]) => ({
      id,
      label: cfg.label || id,
    })),
  ];

  const getModelsForProviderId = (providerId: string): string[] => {
    return providerOptions.find(p => p.id === providerId)?.models ?? [];
  };

  return (
    <div className="h-screen flex flex-col bg-[#121214] text-zinc-200 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Sliders size={18} className="text-indigo-400" />
            Oboto Settings
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">Configure providers, routing, permissions, and behavior</p>
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

        {/* ── Providers Section ────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Providers</h2>
            <span className="text-xs text-zinc-500">Configure LLM connections</span>
          </div>

          {/* Managed Oboto Local provider card */}
          <ManagedProviderCard
            providerOptions={providerOptions}
            pulling={pulling}
            pullStatus={pullStatus}
            pullError={pullError}
            onPull={handlePullModel}
            onTest={(model) => handleTest('oboto', model)}
            testing={testingIds.has('oboto')}
            testResult={testResults['oboto'] ?? null}
          />

          {/* User-configured providers */}
          {Object.entries(providers).map(([id, config]) => {
            const option = providerOptions.find(p => p.id === id);
            return (
              <ProviderCard
                key={id}
                id={id}
                config={config}
                option={option}
                showApiKey={showApiKeys.has(id)}
                onToggleApiKey={() => toggleApiKeyVisibility(id)}
                onChange={(cfg) => updateProvider(id, cfg)}
                onDelete={() => removeProvider(id)}
                onTest={(model) => handleTest(id, model)}
                testing={testingIds.has(id)}
                testResult={testResults[id] ?? null}
              />
            );
          })}

          {/* Add provider */}
          {addingProvider ? (
            <div className="p-4 border border-dashed border-zinc-700 rounded-lg space-y-3">
              <Field label="Provider type">
                <select
                  value={newProviderType}
                  onChange={e => setNewProviderType(e.target.value)}
                  className="select"
                >
                  {PROVIDER_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <div className="flex items-center gap-2">
                <button
                  onClick={addProvider}
                  className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors flex items-center gap-1.5"
                >
                  <Plus size={12} /> Add
                </button>
                <button
                  onClick={() => setAddingProvider(false)}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingProvider(true)}
              className="w-full p-3 border border-dashed border-zinc-700 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Add Provider
            </button>
          )}
        </section>

        {/* ── Routing Section ────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ArrowRight size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Routing</h2>
            <span className="text-xs text-zinc-500">Assign providers to task roles</span>
          </div>

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
                  Use a separate model to classify whether a query needs the main executor model.
                  Saves cost on simple queries.
                </div>
              </span>
            </label>
          </Field>

          {ROUTING_ROLES.map(role => {
            const assignment = routing[role.key];
            const isOptional = role.key === 'planner' || role.key === 'summarizer';
            const isTriageDisabled = role.key === 'triage' && !(value('triageEnabled') ?? true);
            const models = assignment?.providerId ? getModelsForProviderId(assignment.providerId) : [];

            return (
              <div
                key={role.key}
                className={`p-4 rounded-lg border ${
                  isTriageDisabled ? 'opacity-50 border-zinc-800 bg-zinc-900/20' : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-zinc-200">{role.label}</span>
                  <span className="text-xs text-zinc-500">{role.description}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Provider</label>
                    <select
                      value={assignment?.providerId ?? (isOptional ? '' : 'oboto')}
                      onChange={e => {
                        const pid = e.target.value;
                        if (!pid && isOptional) {
                          updateRoute(role.key, undefined);
                        } else {
                          updateRoute(role.key, { providerId: pid, model: assignment?.model });
                        }
                      }}
                      disabled={isTriageDisabled}
                      className="select"
                    >
                      {isOptional && <option value="">Same as executor</option>}
                      {allProviderChoices.map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Model</label>
                    <select
                      value={assignment?.model ?? ''}
                      onChange={e => {
                        if (!assignment?.providerId && !isOptional) return;
                        const pid = assignment?.providerId ?? 'oboto';
                        updateRoute(role.key, { providerId: pid, model: e.target.value || undefined });
                      }}
                      disabled={isTriageDisabled || (!assignment?.providerId && isOptional)}
                      className="select"
                    >
                      <option value="">Provider default</option>
                      {models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {isTriageDisabled && (
                  <div className="mt-2 text-xs text-zinc-500">
                    Triage disabled — all queries go directly to the executor.
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* ── Permissions Section ────────────────────────────── */}
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

        {/* ── Behavior Section ────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Sliders size={16} className="text-cyan-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Behavior</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Max iterations per turn">
              <input
                type="number"
                value={value('maxIterations') ?? 50}
                onChange={e => update('maxIterations', parseInt(e.target.value, 10) || 50)}
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

          <Field label="">
            <div className="flex items-center gap-2 mb-1.5">
              <Terminal size={14} className="text-zinc-400" />
              <label className="text-xs font-medium text-zinc-400">Default shell</label>
            </div>
            <select
              value={value('shell') ?? ''}
              onChange={e => update('shell', e.target.value)}
              className="select"
            >
              <option value="">Auto-detect</option>
              <option value="/bin/zsh">Zsh</option>
              <option value="/bin/bash">Bash</option>
              <option value="/bin/sh">POSIX sh</option>
            </select>
            <p className="text-xs text-zinc-500 mt-1.5">
              Shell used for tool commands. Auto-detect uses your $SHELL environment variable.
            </p>
          </Field>
        </section>
        </div>
      </div>

      {/* Action bar */}
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
        .input:disabled, .select:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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

/* ── Sub-components ──────────────────────────────────────────────── */

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    {label && <label className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</label>}
    {children}
  </div>
);

interface ManagedProviderCardProps {
  providerOptions: ProviderOption[];
  pulling: boolean;
  pullStatus: string | null;
  pullError: string | null;
  onPull: (model: string) => void;
  onTest: (model: string) => void;
  testing: boolean;
  testResult: TestResult | null;
}

const ManagedProviderCard: React.FC<ManagedProviderCardProps> = ({
  providerOptions, pulling, pullStatus, pullError, onPull, onTest, testing, testResult,
}) => {
  const managed = providerOptions.find(p => p.managed);
  const models = managed?.models ?? [];
  const isRunning = managed?.serviceRunning ?? false;
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    if (models.length > 0 && (!selectedModel || !models.includes(selectedModel))) {
      setSelectedModel(models[0]);
    }
  }, [models]);

  return (
    <div className="p-4 rounded-lg border border-emerald-900/50 bg-emerald-950/20 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-emerald-400" />
          <span className="text-sm font-medium text-zinc-200">Oboto Local</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/40">
            managed
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          <span className="text-xs text-zinc-500">
            Ollama {isRunning ? 'running' : 'offline'}
          </span>
        </div>
      </div>

      {!isRunning && (
        <div className="p-2.5 bg-amber-900/20 border border-amber-800/40 rounded text-xs text-amber-200 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-amber-400 flex-shrink-0" />
          <span>Setting up Ollama automatically...</span>
        </div>
      )}

      <Field label="Model">
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="select"
        >
          {models.length === 0 && (
            <option value="" disabled>
              {isRunning ? 'No models installed' : 'Ollama offline'}
            </option>
          )}
          {models.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>

      {pulling && pullStatus && (
        <div className="p-2 bg-indigo-900/30 border border-indigo-800/50 rounded text-xs text-indigo-200 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-indigo-400 flex-shrink-0" />
          <span>{pullStatus}</span>
        </div>
      )}
      {pullError && !pulling && (
        <div className="p-2 bg-red-900/30 border border-red-800/50 rounded text-xs text-red-200 flex items-start gap-2">
          <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <span>{pullError}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <TestButton
          label="Test"
          onClick={() => onTest(selectedModel)}
          testing={testing}
          result={testResult}
          disabled={!selectedModel}
        />
        <button
          onClick={() => {
            const name = prompt('Model name to pull (e.g. llama3.1:8b):');
            if (name?.trim()) onPull(name.trim());
          }}
          disabled={pulling}
          className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <Download size={12} /> Pull model
        </button>
      </div>
    </div>
  );
};

interface ProviderCardProps {
  id: string;
  config: SettingsProviderConfig;
  option?: ProviderOption;
  showApiKey: boolean;
  onToggleApiKey: () => void;
  onChange: (config: SettingsProviderConfig) => void;
  onDelete: () => void;
  onTest: (model: string) => void;
  testing: boolean;
  testResult: TestResult | null;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  id, config, option, showApiKey, onToggleApiKey, onChange, onDelete, onTest, testing, testResult,
}) => {
  const models = option?.models ?? [];
  const selectedModel = config.defaultModel || models[0] || '';

  return (
    <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-indigo-400" />
          <span className="text-sm font-medium text-zinc-200">{config.label || id}</span>
          <span className="text-xs text-zinc-500">({config.type})</span>
        </div>
        <button
          onClick={onDelete}
          className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
          title="Remove provider"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Display name">
          <input
            type="text"
            value={config.label || ''}
            onChange={e => onChange({ ...config, label: e.target.value })}
            placeholder={PROVIDER_TYPES.find(t => t.value === config.type)?.label ?? config.type}
            className="input"
          />
        </Field>

        <Field label="Default model">
          {models.length > 0 ? (
            <select
              value={selectedModel}
              onChange={e => onChange({ ...config, defaultModel: e.target.value })}
              className="select"
            >
              {models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <select disabled className="select">
              <option>Save to fetch models</option>
            </select>
          )}
        </Field>
      </div>

      {option?.requiresApiKey && (
        <Field label="API Key">
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey || ''}
              onChange={e => onChange({ ...config, apiKey: e.target.value })}
              placeholder={option.envKeySet ? `Using ${option.envKeyVar} env var` : 'Paste your API key'}
              className="input pr-10"
            />
            <button
              type="button"
              onClick={onToggleApiKey}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
            >
              {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5">
            <Key size={12} />
            Env var: <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400">{option.envKeyVar}</code>
            {option.envKeySet && <span className="text-emerald-500">detected</span>}
          </div>
        </Field>
      )}

      {config.baseUrl !== undefined && (
        <Field label="Base URL">
          <input
            type="text"
            value={config.baseUrl || ''}
            onChange={e => onChange({ ...config, baseUrl: e.target.value })}
            placeholder={option?.defaultBaseUrl || 'Default'}
            className="input"
          />
        </Field>
      )}

      <div className="flex items-center gap-3">
        <TestButton
          label="Test connection"
          onClick={() => onTest(selectedModel)}
          testing={testing}
          result={testResult}
        />
      </div>
    </div>
  );
};

interface TestButtonProps {
  label: string;
  onClick: () => void;
  testing: boolean;
  result: TestResult | null;
  disabled?: boolean;
}

const TestButton: React.FC<TestButtonProps> = ({ label, onClick, testing, result, disabled }) => (
  <div className="flex items-center gap-3 min-w-0">
    <button
      onClick={onClick}
      disabled={testing || disabled}
      className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors flex items-center gap-1.5 disabled:opacity-50 flex-shrink-0"
    >
      {testing ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
      {testing ? 'Testing...' : label}
    </button>
    {result && (
      <span
        className={`text-xs flex items-center gap-1.5 min-w-0 ${result.success ? 'text-emerald-400' : 'text-red-400'}`}
        title={result.message}
      >
        {result.success ? <CheckCircle2 size={14} className="flex-shrink-0" /> : <XCircle size={14} className="flex-shrink-0" />}
        <span className="truncate">{result.message.length > 80 ? result.message.slice(0, 77) + '...' : result.message}</span>
      </span>
    )}
  </div>
);
