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
    <div className="my-2 bg-[#0c0c0c] border border-vscode-panelBorder rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-vscode-widgetBg/80 border-b border-vscode-panelBorder">
        <Icon size={14} className="text-vscode-desc" />
        <span className="text-xs text-vscode-desc font-mono">{toolName} result</span>
      </div>
      <div className="p-3 text-xs font-mono overflow-x-auto leading-relaxed text-vscode-editorFg whitespace-pre-wrap">
        {cleanOutput.trim() || <span className="text-vscode-disabled italic">No output</span>}
      </div>
    </div>
  );
};
