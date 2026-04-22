import React from 'react';
import { FileText, Check, X } from 'lucide-react';
import type { PlanApprovalMode } from '../../../src/shared/message-types';

interface PlanApprovalPromptProps {
  promptId: string;
  planSummary: string;
  planFilePath: string;
  status: 'pending' | 'approved' | 'denied';
  approvalMode?: PlanApprovalMode;
  onRespond: (promptId: string, response: { denied?: boolean; approvalMode?: PlanApprovalMode }) => void;
}

export const PlanApprovalPrompt: React.FC<PlanApprovalPromptProps> = ({
  promptId,
  planSummary,
  status,
  approvalMode,
  onRespond,
}) => {
  if (status === 'approved') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <Check size={14} className="text-emerald-400" />
          <span className="text-vscode-desc">Plan approved</span>
          <span className="text-vscode-editorFg">
            ({approvalMode === 'auto' ? 'auto-accept changes' : 'review each change'})
          </span>
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <X size={14} className="text-red-400" />
          <span className="text-vscode-desc">Plan denied</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-3 ml-4 border-l-2 border-violet-500/40 my-2 fade-in">
      <div className="bg-vscode-widgetBg/60 border border-violet-500/20 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-violet-400" />
          <span className="text-sm font-medium text-violet-300">Plan Approval</span>
        </div>

        <div className="text-sm text-vscode-editorFg">{planSummary}</div>
        <div className="text-xs text-vscode-desc italic">Full plan opened in editor preview</div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onRespond(promptId, { approvalMode: 'auto' })}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
          >
            Approve (auto-accept)
          </button>
          <button
            onClick={() => onRespond(promptId, { approvalMode: 'manual' })}
            className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded transition-colors"
          >
            Approve (review each)
          </button>
          <button
            onClick={() => onRespond(promptId, { denied: true })}
            className="px-3 py-1.5 text-xs font-medium bg-vscode-inputBg hover:bg-vscode-hoverBg text-vscode-editorFg rounded transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
};
