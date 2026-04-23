import * as vscode from 'vscode';
import { EXTENSION_ID } from '../shared/constants';

export interface ProviderConfig {
  type: string;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export type PromptRole = 'triage' | 'executor' | 'planner' | 'summarizer' | 'coder';

export interface RouteAssignment {
  providerId: string;
  model?: string;
}

export interface ObotovsSettings {
  providers: Record<string, ProviderConfig>;
  routing: Partial<Record<PromptRole, RouteAssignment>>;
  triageEnabled: boolean;
  permissionMode: 'readonly' | 'workspace-write' | 'full-access' | 'prompt';
  maxIterations: number;
  maxContextTokens: number;
  autoCompact: boolean;
  autoCompactThreshold: number;
  instructionFile: string;
  maxConcurrentAgents: number;
  defaultAgentBudgetUsd: number;
  agentTimeoutMs: number;
  maxAgentNestingDepth: number;
  surfacesAutoOpen: boolean;
  uiControlEnabled: boolean;
  peerDispatchEnabled: boolean;
  subconsciousEnabled: boolean;
  shell: string;
  openclaw?: { mode: 'managed' | 'connected'; url: string; };
}

const DEFAULT_ROUTING: Record<string, RouteAssignment> = {
  triage:   { providerId: 'oboto' },
  executor: { providerId: 'oboto' },
};

export function getSettings(): ObotovsSettings {
  const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);

  return {
    providers: cfg.get<Record<string, ProviderConfig>>('providers', {}),
    routing: cfg.get<Partial<Record<PromptRole, RouteAssignment>>>('routing', DEFAULT_ROUTING),
    triageEnabled: cfg.get<boolean>('triageEnabled', true),
    permissionMode: cfg.get<ObotovsSettings['permissionMode']>('permissionMode', 'prompt'),
    maxIterations: cfg.get<number>('maxIterations', 50),
    maxContextTokens: cfg.get<number>('maxContextTokens', 128_000),
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
    subconsciousEnabled: cfg.get<boolean>('subconsciousEnabled', false),
    shell: cfg.get<string>('shell', ''),
    openclaw: cfg.get<ObotovsSettings['openclaw']>('openclaw'),
  };
}

export function onSettingsChanged(handler: (settings: ObotovsSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(EXTENSION_ID)) {
      handler(getSettings());
    }
  });
}
