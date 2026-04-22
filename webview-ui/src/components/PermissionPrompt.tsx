import React from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';

interface PermissionPromptProps {
  id: string;
  toolName: string;
  description: string;
  status: 'pending' | 'allowed' | 'denied';
  onRespond: (eventId: string, allowed: boolean, remember: boolean) => void;
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({ id, toolName, description, status, onRespond }) => {
  if (status !== 'pending') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          {status === 'allowed' ? (
            <>
              <Check size={14} className="text-emerald-400" />
              <span className="text-emerald-400">Allowed:</span>
            </>
          ) : (
            <>
              <X size={14} className="text-red-400" />
              <span className="text-red-400">Denied:</span>
            </>
          )}
          <span className="text-vscode-desc font-mono">{toolName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-3 ml-4 border-l-2 border-amber-500/40 my-2 fade-in">
      <div role="alertdialog" aria-label="Permission required" aria-describedby={`perm-desc-${id}`} className="bg-vscode-widgetBg/60 border border-amber-500/20 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-amber-400" />
          <span className="text-sm font-medium text-amber-300">Permission Required</span>
        </div>

        <div id={`perm-desc-${id}`} className="text-sm text-vscode-editorFg">
          <span className="font-mono text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded">{toolName}</span>
          <p className="mt-1.5 text-vscode-desc">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onRespond(id, true, false)}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
          >
            Allow Once
          </button>
          <button
            onClick={() => onRespond(id, true, true)}
            className="px-3 py-1.5 text-xs font-medium bg-vscode-hoverBg hover:bg-zinc-600 text-vscode-editorFg rounded transition-colors"
          >
            Allow for Session
          </button>
          <button
            onClick={() => onRespond(id, false, false)}
            className="px-3 py-1.5 text-xs font-medium bg-red-900/60 hover:bg-red-800/60 text-red-300 rounded transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
};
