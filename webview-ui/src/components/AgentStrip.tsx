import React from 'react';
import { Bot, Loader2, Check, XCircle, AlertTriangle, X, Terminal } from 'lucide-react';
import type { AgentSummary, AgentSyncMetrics } from '../../../src/shared/message-types';
import { FOREGROUND_AGENT_ID } from '../../../src/shared/message-types';

interface AgentStripProps {
  agents: AgentSummary[];
  focusedAgentId: string;
  syncMetrics?: Record<string, AgentSyncMetrics>;
  onFocus: (agentId: string) => void;
  onCancel: (agentId: string) => void;
}

export const AgentStrip: React.FC<AgentStripProps> = ({ agents, focusedAgentId, syncMetrics, onFocus, onCancel }) => {
  // Only show background agents (exclude foreground; it's the default view)
  const background = agents.filter((a) => a.id !== FOREGROUND_AGENT_ID);
  if (background.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-t border-vscode-panelBorder bg-vscode-editorBg/60 px-3 py-2 overflow-x-auto">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-vscode-desc font-medium uppercase tracking-wider shrink-0 mr-1">
          Agents
        </span>

        {/* Foreground pill — always first */}
        <button
          onClick={() => onFocus(FOREGROUND_AGENT_ID)}
          className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
            focusedAgentId === FOREGROUND_AGENT_ID
              ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200'
              : 'bg-vscode-widgetBg border-vscode-panelBorder text-vscode-desc hover:text-vscode-editorFg hover:border-vscode-widgetBorder'
          }`}
          title="Main chat"
        >
          <Terminal size={12} />
          <span>foreground</span>
        </button>

        {background.map((a) => (
          <AgentPill
            key={a.id}
            agent={a}
            focused={focusedAgentId === a.id}
            syncScore={syncMetrics?.[a.id]?.syncScore}
            onFocus={onFocus}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
};

interface AgentPillProps {
  agent: AgentSummary;
  focused: boolean;
  syncScore?: number;
  onFocus: (id: string) => void;
  onCancel: (id: string) => void;
}

const AgentPill: React.FC<AgentPillProps> = ({ agent, focused, syncScore, onFocus, onCancel }) => {
  const StatusIcon = (() => {
    switch (agent.status) {
      case 'running':
        return <Loader2 size={12} className="animate-spin text-amber-400" />;
      case 'complete':
        return <Check size={12} className="text-emerald-400" />;
      case 'error':
        return <AlertTriangle size={12} className="text-red-400" />;
      case 'cancelled':
        return <XCircle size={12} className="text-vscode-desc" />;
      case 'idle':
      default:
        return <Bot size={12} className="text-vscode-desc" />;
    }
  })();

  const colorClasses = focused
    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200'
    : agent.status === 'running'
    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200 hover:bg-amber-500/15'
    : agent.status === 'error'
    ? 'bg-red-500/10 border-red-500/30 text-red-200 hover:bg-red-500/15'
    : 'bg-vscode-widgetBg border-vscode-panelBorder text-vscode-desc hover:text-vscode-editorFg hover:border-vscode-widgetBorder';

  return (
    <div
      className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer max-w-[240px] ${colorClasses}`}
      onClick={() => onFocus(agent.id)}
      title={`${agent.id} · ${agent.status} · $${agent.cost.totalCost.toFixed(4)}\n\n${agent.task ?? agent.label}`}
    >
      {StatusIcon}
      <span className="truncate">{agent.label}</span>
      <span className="text-[10px] text-vscode-desc font-mono shrink-0">
        ${agent.cost.totalCost.toFixed(3)}
      </span>
      {agent.status === 'running' && syncScore != null && syncScore > 0.05 && (
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            syncScore > 0.7
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
              : syncScore > 0.3
              ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]'
              : 'bg-zinc-500'
          }`}
          title={`Sync: ${(syncScore * 100).toFixed(0)}% — ${
            syncScore > 0.7 ? 'converging with other agents'
              : syncScore > 0.3 ? 'partial overlap with other agents'
              : 'mostly independent'
          }`}
        />
      )}
      {agent.status === 'running' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCancel(agent.id);
          }}
          className="ml-1 p-0.5 rounded hover:bg-vscode-hoverBg/60 text-vscode-desc hover:text-red-300"
          title="Cancel this agent"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};
