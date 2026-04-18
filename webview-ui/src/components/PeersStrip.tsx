import React, { useState } from 'react';
import { MonitorSmartphone, ChevronDown, ChevronRight } from 'lucide-react';
import type { PeerUiSnapshot } from '../../../src/shared/message-types';

interface PeersStripProps {
  peers: PeerUiSnapshot[];
}

function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

export const PeersStrip: React.FC<PeersStripProps> = ({ peers }) => {
  const [expanded, setExpanded] = useState(false);

  if (peers.length === 0) return null;

  const running = peers.reduce(
    (n, p) => n + p.agents.filter((a) => a.status === 'running').length,
    0,
  );

  return (
    <div className="px-4 py-1.5 bg-zinc-950/80 border-b border-zinc-800/60 text-xs text-zinc-400 flex-shrink-0">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors"
        title={`${peers.length} peer window${peers.length === 1 ? '' : 's'} · ${running} running`}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <MonitorSmartphone size={12} className="text-indigo-400" />
        <span>
          <span className="text-zinc-200">{peers.length}</span> peer{peers.length === 1 ? '' : 's'}
          {running > 0 && (
            <> · <span className="text-emerald-400">{running} running</span></>
          )}
        </span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 space-y-1">
          {peers.map((p) => {
            const r = p.agents.filter((a) => a.status === 'running').length;
            return (
              <div key={p.windowId} className="font-mono text-[11px] leading-relaxed">
                <div className="flex items-center gap-2 text-zinc-300">
                  <span className="text-zinc-500">{p.windowId.slice(0, 8)}</span>
                  <span className="text-zinc-600">pid {p.pid}</span>
                  <span className="text-zinc-600">up {relTime(p.startedAt)}</span>
                  <span className="text-zinc-500">{p.agents.length} agent{p.agents.length === 1 ? '' : 's'}</span>
                  {r > 0 && <span className="text-emerald-500">{r} running</span>}
                </div>
                {p.agents.map((a) => (
                  <div key={a.id} className="ml-6 text-zinc-500 truncate">
                    <span className={a.status === 'running' ? 'text-emerald-400' : 'text-zinc-600'}>
                      {a.status === 'running' ? '●' : '○'}
                    </span>{' '}
                    <span className="text-zinc-400">{a.id === 'foreground' ? 'foreground' : a.id.slice(0, 10)}</span>{' '}
                    <span className="text-zinc-600">{a.label}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
