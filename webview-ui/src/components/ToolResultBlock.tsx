import React from 'react';
import { Terminal, FileText, Search, Code, Check } from 'lucide-react';

interface ToolResultBlockProps {
  toolName: string;
  output: string;
}

export const ToolResultBlock: React.FC<ToolResultBlockProps> = ({ toolName, output }) => {
  let Icon = Terminal;
  if (toolName.startsWith('file/')) Icon = FileText;
  else if (toolName.startsWith('search/')) Icon = Search;
  else if (toolName.startsWith('shell/')) Icon = Terminal;
  else Icon = Code;

  // Clean up the output string if it has [Context: /]
  let cleanOutput = output;
  if (cleanOutput.startsWith('[Context: /]\n')) {
    cleanOutput = cleanOutput.slice('[Context: /]\n'.length);
  } else if (cleanOutput.startsWith('[Context: /]')) {
    cleanOutput = cleanOutput.slice('[Context: /]'.length);
  }

  return (
    <div className="my-2 bg-[#0c0c0c] border border-zinc-800 rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800">
        <Icon size={14} className="text-zinc-500" />
        <span className="text-xs text-zinc-400 font-mono">{toolName} result</span>
      </div>
      <div className="p-3 text-xs font-mono overflow-x-auto leading-relaxed text-zinc-300 whitespace-pre-wrap">
        {cleanOutput.trim() || <span className="text-zinc-600 italic">No output</span>}
      </div>
    </div>
  );
};
