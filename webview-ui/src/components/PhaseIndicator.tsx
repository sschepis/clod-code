import React, { useState, useRef, useEffect } from 'react';
import { Loader2, Cpu, Wrench, CheckCircle, AlertTriangle, Brain, ClipboardList, Database, RotateCcw, XCircle } from 'lucide-react';
import type { AgentPhase } from '../../../src/shared/message-types';
import { pickNewMessage } from '../spinner-messages';

interface PhaseIndicatorProps {
  phase: AgentPhase;
  message: string;
}

const CHAR_DELAY = 9;
const CYCLE_DELAY = 3000;
const FADE_DURATION = 150;

const SPINNER_PHASES = new Set<AgentPhase>([
  'thinking', 'tools', 'planning', 'precheck', 'continuation', 'memory',
]);

const PHASE_CONFIG: Record<AgentPhase, { icon: React.ReactNode; color: string; animate?: boolean }> = {
  idle: { icon: null, color: '' },
  request: { icon: <Loader2 size={14} />, color: 'text-vscode-desc', animate: true },
  precheck: { icon: <Cpu size={14} />, color: 'text-blue-400', animate: true },
  planning: { icon: <ClipboardList size={14} />, color: 'text-cyan-400', animate: true },
  thinking: { icon: <Brain size={14} />, color: 'text-indigo-400', animate: true },
  tools: { icon: <Wrench size={14} />, color: 'text-amber-400', animate: true },
  validation: { icon: <CheckCircle size={14} />, color: 'text-emerald-400' },
  memory: { icon: <Database size={14} />, color: 'text-purple-400' },
  continuation: { icon: <RotateCcw size={14} />, color: 'text-cyan-400', animate: true },
  error: { icon: <AlertTriangle size={14} />, color: 'text-red-400' },
  doom: { icon: <AlertTriangle size={14} />, color: 'text-red-500' },
  cancel: { icon: <XCircle size={14} />, color: 'text-vscode-desc' },
  complete: { icon: <CheckCircle size={14} />, color: 'text-emerald-500' },
};

export const PhaseIndicator: React.FC<PhaseIndicatorProps> = ({ phase, message }) => {
  if (phase === 'idle') return null;

  const isSpinner = SPINNER_PHASES.has(phase);
  const [displayText, setDisplayText] = useState(isSpinner ? '' : message);
  const [typing, setTyping] = useState(isSpinner);
  const [opacity, setOpacity] = useState(1);
  const [cycleKey, setCycleKey] = useState(0);
  const targetMsg = useRef(message);

  useEffect(() => {
    targetMsg.current = message;
    setOpacity(1);
    setTyping(isSpinner);
    if (!isSpinner) {
      setDisplayText(message);
    }
    setCycleKey(k => k + 1);
  }, [phase, message]);

  useEffect(() => {
    if (!isSpinner) return;

    let cancelled = false;
    let charIdx = 0;
    const target = targetMsg.current;

    setDisplayText('');
    setTyping(true);

    const typeTimer = window.setInterval(() => {
      if (cancelled) { clearInterval(typeTimer); return; }
      charIdx++;
      setDisplayText(target.slice(0, charIdx));
      if (charIdx >= target.length) {
        clearInterval(typeTimer);
        setTyping(false);
        setTimeout(() => {
          if (cancelled) return;
          setOpacity(0);
          setTimeout(() => {
            if (cancelled) return;
            targetMsg.current = pickNewMessage(target);
            setOpacity(1);
            setCycleKey(k => k + 1);
          }, FADE_DURATION);
        }, CYCLE_DELAY);
      }
    }, CHAR_DELAY);

    return () => { cancelled = true; clearInterval(typeTimer); };
  }, [cycleKey]);

  const config = PHASE_CONFIG[phase];

  return (
    <div className="px-6 py-3 flex items-center gap-3 text-sm border-b border-vscode-panelBorder/30 bg-vscode-widgetBg/20 fade-in">
      <div className={`${config.color} ${config.animate ? 'animate-spin' : ''}`}>
        {config.icon}
      </div>
      <span
        className={`${config.color} font-medium`}
        style={{ transition: `opacity ${FADE_DURATION}ms ease`, opacity }}
      >
        {displayText}
        {typing && <span className="animate-pulse ml-px">▎</span>}
      </span>
    </div>
  );
};
