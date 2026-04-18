import React from 'react';
import { Loader2, Cpu, Wrench, CheckCircle, AlertTriangle, Brain, ClipboardList, Database, RotateCcw, XCircle } from 'lucide-react';
import type { AgentPhase } from '../../../src/shared/message-types';

interface PhaseIndicatorProps {
  phase: AgentPhase;
  message: string;
}

const PHASE_CONFIG: Record<AgentPhase, { icon: React.ReactNode; color: string; animate?: boolean }> = {
  idle: { icon: null, color: '' },
  request: { icon: <Loader2 size={14} />, color: 'text-zinc-400', animate: true },
  precheck: { icon: <Cpu size={14} />, color: 'text-blue-400', animate: true },
  planning: { icon: <ClipboardList size={14} />, color: 'text-cyan-400', animate: true },
  thinking: { icon: <Brain size={14} />, color: 'text-indigo-400', animate: true },
  tools: { icon: <Wrench size={14} />, color: 'text-amber-400', animate: true },
  validation: { icon: <CheckCircle size={14} />, color: 'text-emerald-400' },
  memory: { icon: <Database size={14} />, color: 'text-purple-400' },
  continuation: { icon: <RotateCcw size={14} />, color: 'text-cyan-400', animate: true },
  error: { icon: <AlertTriangle size={14} />, color: 'text-red-400' },
  doom: { icon: <AlertTriangle size={14} />, color: 'text-red-500' },
  cancel: { icon: <XCircle size={14} />, color: 'text-zinc-400' },
  complete: { icon: <CheckCircle size={14} />, color: 'text-emerald-500' },
};

export const PhaseIndicator: React.FC<PhaseIndicatorProps> = ({ phase, message }) => {
  if (phase === 'idle') return null;

  const config = PHASE_CONFIG[phase];

  return (
    <div className="px-6 py-3 flex items-center gap-3 text-sm border-b border-zinc-800/30 bg-zinc-900/20 fade-in">
      <div className={`${config.color} ${config.animate ? 'animate-spin' : ''}`}>
        {config.icon}
      </div>
      <span className={`${config.color} font-medium`}>{message}</span>
    </div>
  );
};
