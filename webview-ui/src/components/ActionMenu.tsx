import React, { useState } from 'react';
import { Check, Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react';

interface ActionMenuProps {
  content: string;
  onRevert: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
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

export const ActionMenu: React.FC<ActionMenuProps> = ({ content, onRevert, onEdit, onDelete, id, role }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-zinc-800/90 border border-zinc-700 backdrop-blur-sm rounded-md p-1 shadow-lg z-10">
      <button
        onClick={handleCopy}
        className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors"
        title="Copy text"
      >
        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
      {role === 'user' && onEdit && (
        <button
          onClick={() => onEdit(id, content)}
          className="p-1.5 text-zinc-400 hover:text-blue-400 hover:bg-zinc-700 rounded transition-colors"
          title="Edit & resubmit"
        >
          <Pencil size={14} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => onDelete(id)}
          className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors"
          title="Delete message"
        >
          <Trash2 size={14} />
        </button>
      )}
      <button
        onClick={() => onRevert(id)}
        className="p-1.5 text-zinc-400 hover:text-amber-400 hover:bg-zinc-700 rounded transition-colors"
        title="Revert to here"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
};
