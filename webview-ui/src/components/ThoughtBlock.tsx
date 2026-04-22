import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Cpu } from 'lucide-react';

interface ThoughtBlockProps {
  content: string;
  duration?: string;
}

export const ThoughtBlock: React.FC<ThoughtBlockProps> = ({ content, duration }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 group relative fade-in">
      <div
        className="flex items-center gap-3 cursor-pointer select-none text-vscode-desc hover:text-vscode-editorFg transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-center w-5 h-5 rounded hover:bg-vscode-inputBg transition-colors">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <Cpu size={14} className="text-vscode-disabled" />
        <span className="text-sm font-medium italic">Agent is thinking...</span>
        {duration && <span className="text-xs text-vscode-disabled font-mono ml-auto">{duration}</span>}
      </div>

      {isExpanded && (
        <div className="mt-2 pl-8 pr-4 py-2">
          <p className="text-sm text-vscode-desc italic leading-relaxed">{content}</p>
        </div>
      )}
    </div>
  );
};
