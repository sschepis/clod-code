import React, { useState } from 'react';
import { Check, Copy, Pencil, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';

interface ActionMenuProps {
  content: string;
  onRevert: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
  onRerun?: (id: string, content: string) => void;
  onDelete?: (id: string) => void;
  id: string;
  role: 'user' | 'assistant';
}

function copyToClipboard(text: string) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

export const ActionMenu: React.FC<ActionMenuProps> = ({ content, onRevert, onEdit, onRerun, onDelete, id, role }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-vscode-inputBg/90 border border-vscode-widgetBorder backdrop-blur-sm rounded-md p-1 shadow-lg z-10">
      <button
        onClick={handleCopy}
        className="p-1.5 text-vscode-desc hover:text-vscode-editorFg hover:bg-vscode-hoverBg rounded transition-colors"
        title="Copy text"
      >
        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
      {role === 'user' && onEdit && (
        <button
          onClick={() => onEdit(id, content)}
          className="p-1.5 text-vscode-desc hover:text-blue-400 hover:bg-vscode-hoverBg rounded transition-colors"
          title="Edit & resubmit"
        >
          <Pencil size={14} />
        </button>
      )}
      {role === 'user' && onRerun && (
        <button
          onClick={() => onRerun(id, content)}
          className="p-1.5 text-vscode-desc hover:text-emerald-400 hover:bg-vscode-hoverBg rounded transition-colors"
          title="Rerun message"
        >
          <RefreshCw size={14} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => onDelete(id)}
          className="p-1.5 text-vscode-desc hover:text-red-400 hover:bg-vscode-hoverBg rounded transition-colors"
          title="Delete message"
        >
          <Trash2 size={14} />
        </button>
      )}
      <button
        onClick={() => onRevert(id)}
        className="p-1.5 text-vscode-desc hover:text-amber-400 hover:bg-vscode-hoverBg rounded transition-colors"
        title="Revert to here"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
};
