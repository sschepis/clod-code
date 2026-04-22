import React from 'react';
import {
  Trash2, Search, Terminal, Cpu, HelpCircle, GitBranch,
  AlertTriangle, DollarSign, Package, Info
} from 'lucide-react';
import type { SlashCommandInfo } from '../../../src/shared/message-types';

interface SlashCommandMenuProps {
  commands: SlashCommandInfo[];
  filter: string;
  onSelect: (command: string) => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  trash: <Trash2 size={14} className="text-red-400" />,
  cpu: <Cpu size={14} className="text-indigo-400" />,
  info: <Info size={14} className="text-blue-400" />,
  dollar: <DollarSign size={14} className="text-emerald-400" />,
  compress: <Package size={14} className="text-purple-400" />,
  help: <HelpCircle size={14} className="text-vscode-desc" />,
  git: <GitBranch size={14} className="text-orange-400" />,
  warning: <AlertTriangle size={14} className="text-yellow-400" />,
  search: <Search size={14} className="text-blue-400" />,
  terminal: <Terminal size={14} className="text-purple-400" />,
};

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ commands, filter, onSelect }) => {
  // Filter commands by what the user has typed after "/"
  const query = filter.startsWith('/') ? filter.slice(1).toLowerCase() : '';
  const filtered = commands.filter(
    cmd => cmd.name.toLowerCase().includes(query) || cmd.summary.toLowerCase().includes(query)
  );

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-4 mb-2 w-72 bg-vscode-widgetBg border border-vscode-widgetBorder rounded-lg shadow-xl overflow-hidden z-30">
      <div className="px-3 py-2 text-xs font-semibold text-vscode-desc bg-vscode-editorBg border-b border-vscode-panelBorder">
        Commands
      </div>
      <ul className="py-1 max-h-[240px] overflow-y-auto">
        {filtered.map(cmd => (
          <li
            key={cmd.name}
            className="px-3 py-2 hover:bg-vscode-inputBg cursor-pointer flex items-center gap-2 text-sm text-vscode-editorFg"
            onClick={() => onSelect(cmd.name)}
          >
            {ICON_MAP[cmd.icon || ''] || <Terminal size={14} className="text-vscode-desc" />}
            <span className="font-mono text-vscode-desc">/{cmd.name}</span>
            {cmd.argumentHint && (
              <span className="text-vscode-disabled text-xs">{cmd.argumentHint}</span>
            )}
            <span className="text-vscode-desc text-xs ml-auto">{cmd.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
