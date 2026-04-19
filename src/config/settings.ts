import * as vscode from 'vscode';
import { EXTENSION_ID } from '../shared/constants';

export interface PromptRouteEntry {
  provider: string;
  model: string;
}

export type PromptRole = 'orchestrator' | 'planner' | 'actor' | 'summarizer';

export interface ClodcodeSettings {
  localProvider: string;
  localModel: string;
  localBaseUrl: string;
  localApiKey: string;
  remoteProvider: string;
  remoteModel: string;
  remoteApiKey: string;
  remoteBaseUrl: string;
  providerKeys: Record<string, string>;
  permissionMode: 'readonly' | 'workspace-write' | 'full-access' | 'prompt';
  maxIterations: number;
  maxContextTokens: number;
  triageEnabled: boolean;
  autoCompact: boolean;
  autoCompactThreshold: number;
  instructionFile: string;
  // ── Multi-agent ──────────────────────────────────────────────────
  maxConcurrentAgents: number;
  defaultAgentBudgetUsd: number;
  agentTimeoutMs: number;
  maxAgentNestingDepth: number;
  // ── Surfaces ─────────────────────────────────────────────────────
  surfacesAutoOpen: boolean;
  // ── UI control (nut.js) ──────────────────────────────────────────
  uiControlEnabled: boolean;
  // ── Peer coordination ────────────────────────────────────────────
  /** When false, incoming peer dispatch/ask requests are silently rejected. */
  peerDispatchEnabled: boolean;
  // ── Prompt routing ────────────────────────────────────────────────
  /** Per-role provider+model overrides. Roles: orchestrator, planner, actor, summarizer. */
  promptRouting: Partial<Record<PromptRole, PromptRouteEntry>>;
  // ── Round-robin ───────────────────────────────────────────────────
  roundRobinEnabled: boolean;
  /** Per-provider model overrides for round-robin, e.g. { "openai": "gpt-4o", "anthropic": "claude-sonnet-4-20250514" } */
  roundRobinModels: Record<string, string>;
  // ── Shell ────────────────────────────────────────────────────────
  shell: string;
}

export function getSettings(): ClodcodeSettings {
  const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);

  return {
    localProvider: cfg.get<string>('localProvider', 'ollama'),
    localModel: cfg.get<string>('localModel', 'llama3:8b'),
    localBaseUrl: cfg.get<string>('localBaseUrl', 'http://localhost:11434'),
    localApiKey: cfg.get<string>('localApiKey', ''),
    remoteProvider: cfg.get<string>('remoteProvider', 'anthropic'),
    remoteModel: cfg.get<string>('remoteModel', 'claude-sonnet-4-20250514'),
    remoteApiKey: cfg.get<string>('remoteApiKey', ''),
    remoteBaseUrl: cfg.get<string>('remoteBaseUrl', ''),
    providerKeys: cfg.get<Record<string, string>>('providerKeys', {}),
    permissionMode: cfg.get<ClodcodeSettings['permissionMode']>('permissionMode', 'prompt'),
    maxIterations: cfg.get<number>('maxIterations', 25),
    maxContextTokens: cfg.get<number>('maxContextTokens', 128_000),
    triageEnabled: cfg.get<boolean>('triageEnabled', true),
    autoCompact: cfg.get<boolean>('autoCompact', true),
    autoCompactThreshold: cfg.get<number>('autoCompactThreshold', 150_000),
    instructionFile: cfg.get<string>('instructionFile', 'CLAUDE.md'),
    maxConcurrentAgents: cfg.get<number>('maxConcurrentAgents', 5),
    defaultAgentBudgetUsd: cfg.get<number>('defaultAgentBudgetUsd', 0.5),
    agentTimeoutMs: cfg.get<number>('agentTimeoutMs', 300_000),
    maxAgentNestingDepth: cfg.get<number>('maxAgentNestingDepth', 2),
    surfacesAutoOpen: cfg.get<boolean>('surfacesAutoOpen', true),
    uiControlEnabled: cfg.get<boolean>('uiControlEnabled', false),
    peerDispatchEnabled: cfg.get<boolean>('peerDispatchEnabled', true),
    promptRouting: cfg.get<Partial<Record<PromptRole, PromptRouteEntry>>>('promptRouting', {
      orchestrator: { provider: 'gemini', model: 'gemini-3-flash-preview' },
      planner: { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
      actor: { provider: 'gemini', model: 'gemini-3-flash-preview' },
      summarizer: { provider: 'local', model: '' },
    }),
    roundRobinEnabled: cfg.get<boolean>('roundRobinEnabled', false),
    roundRobinModels: cfg.get<Record<string, string>>('roundRobinModels', {}),
    shell: cfg.get<string>('shell', ''),
  };
}

/**
 * Watch for settings changes and call the handler.
 * Returns a disposable to stop watching.
 */
export function onSettingsChanged(handler: (settings: ClodcodeSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(EXTENSION_ID)) {
      handler(getSettings());
    }
  });
}
