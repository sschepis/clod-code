import React from 'react';
import { Share2, Check, X } from 'lucide-react';

interface PeerDispatchPromptProps {
  promptId: string;
  fromWindowId: string;
  task: string;
  label: string;
  status: 'pending' | 'approved' | 'rejected';
  onRespond: (promptId: string, approved: boolean) => void;
}

export const PeerDispatchPrompt: React.FC<PeerDispatchPromptProps> = ({
  promptId, fromWindowId, task, label, status, onRespond,
}) => {
  if (status === 'approved') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <Check size={14} className="text-emerald-400" />
          <span className="text-vscode-desc">Peer dispatch approved — agent spawned for</span>
          <span className="text-vscode-editorFg truncate">{label}</span>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <X size={14} className="text-vscode-desc" />
          <span className="text-vscode-desc">Peer dispatch denied</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-3 ml-4 border-l-2 border-indigo-500/40 my-2 fade-in">
      <div className="bg-vscode-widgetBg/60 border border-indigo-500/20 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Share2 size={16} className="text-indigo-400" />
          <span className="text-sm font-medium text-indigo-300">Peer Dispatch Request</span>
        </div>

        <div className="text-sm text-vscode-editorFg">
          Window{' '}
          <span className="font-mono text-indigo-400/90 bg-indigo-400/10 px-1.5 py-0.5 rounded">
            {fromWindowId.slice(0, 8)}
          </span>{' '}
          wants to run a task in this window:
        </div>

        <pre className="text-xs font-mono bg-vscode-editorBg border border-vscode-panelBorder rounded p-2.5 text-vscode-editorFg whitespace-pre-wrap max-h-[180px] overflow-y-auto">
          {task}
        </pre>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onRespond(promptId, true)}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
          >
            Approve and run
          </button>
          <button
            onClick={() => onRespond(promptId, false)}
            className="px-3 py-1.5 text-xs font-medium bg-red-900/60 hover:bg-red-800/60 text-red-300 rounded transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
};
