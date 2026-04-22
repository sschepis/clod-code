import React, { useState } from 'react';
import { Send, ChevronDown, ChevronRight, Loader2, Check, X, AlertTriangle, Clock } from 'lucide-react';
import type { OutboundDispatchUi } from '../../../src/shared/message-types';

interface OutboundDispatchesStripProps {
  dispatches: OutboundDispatchUi[];
}

function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

const STATUS_META: Record<OutboundDispatchUi['status'], { icon: React.ReactNode; color: string; label: string }> = {
  pending_approval: { icon: <Clock size={12} />, color: 'text-amber-400', label: 'waiting for approval' },
  running:          { icon: <Loader2 size={12} className="animate-spin" />, color: 'text-emerald-400', label: 'running' },
  completed:        { icon: <Check size={12} />, color: 'text-emerald-500', label: 'completed' },
  error:            { icon: <AlertTriangle size={12} />, color: 'text-red-400', label: 'error' },
  rejected:         { icon: <X size={12} />, color: 'text-vscode-desc', label: 'denied' },
  cancelled:        { icon: <X size={12} />, color: 'text-vscode-desc', label: 'cancelled' },
};

export const OutboundDispatchesStrip: React.FC<OutboundDispatchesStripProps> = ({ dispatches }) => {
  const [expanded, setExpanded] = useState(true);

  if (dispatches.length === 0) return null;

  const active = dispatches.filter((d) => d.status === 'pending_approval' || d.status === 'running').length;

  return (
    <div className="px-4 py-1.5 bg-vscode-editorBg/80 border-b border-vscode-panelBorder/60 text-xs text-vscode-desc flex-shrink-0">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="flex items-center gap-1.5 hover:text-vscode-editorFg transition-colors"
        title={`${dispatches.length} dispatch${dispatches.length === 1 ? '' : 'es'} · ${active} in-flight`}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Send size={12} className="text-violet-400" />
        <span>
          <span className="text-vscode-editorFg">{dispatches.length}</span> dispatch{dispatches.length === 1 ? '' : 'es'}
          {active > 0 && (
            <> · <span className="text-amber-300">{active} in-flight</span></>
          )}
        </span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 space-y-1">
          {dispatches.map((d) => {
            const meta = STATUS_META[d.status];
            return (
              <div key={d.rpcId} className="font-mono text-[11px] leading-relaxed">
                <div className="flex items-center gap-2">
                  <span className={meta.color}>{meta.icon}</span>
                  <span className="text-vscode-desc">→ {d.peerWindowId.slice(0, 8)}</span>
                  <span className={`${meta.color}`}>{meta.label}</span>
                  <span className="text-vscode-disabled">sent {relTime(d.sentAt)} ago</span>
                </div>
                <div className="ml-5 text-vscode-editorFg truncate" title={d.task}>{d.label}</div>
                {d.error && (
                  <div className="ml-5 text-red-400 truncate" title={d.error}>error: {d.error}</div>
                )}
                {d.reason && (
                  <div className="ml-5 text-vscode-desc truncate" title={d.reason}>{d.reason}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
