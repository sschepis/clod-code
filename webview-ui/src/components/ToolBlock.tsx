import React, { useState, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Check, Loader2,
  Search, FileText, Wrench, Terminal, GitBranch, AlertTriangle, Globe, FolderSearch
} from 'lucide-react';
import { ActionMenu } from './ActionMenu';

/** Tool names whose output should be auto-expanded inline — the user wants
 *  terminal activity visible by default, not hidden behind a disclosure. */
const AUTO_EXPAND_TOOLS = new Set([
  'shell run', 'shell background', 'shell terminal',
  'bash', 'terminal',
  'git diff', 'git log',
]);

/** Strip a practical subset of ANSI escape sequences:
 *  - CSI: ESC [ ... <final byte 0x40-0x7E>   (colors, cursor control, erases)
 *  - OSC: ESC ] ... (BEL or ESC \)            (title, hyperlinks)
 *  - SS2/SS3 and simple 2-byte escapes
 *  Keeps newlines, tabs and UTF-8 intact. */
const ANSI_CSI = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const ANSI_ONE = /\x1B[@-Z\\-_]/g;

function stripAnsi(text: string): string {
  return text
    .replace(ANSI_OSC, '')
    .replace(ANSI_CSI, '')
    .replace(ANSI_ONE, '')
    // Strip carriage-return-only sequences (progress bars over-writing lines)
    .replace(/\r(?!\n)/g, '\n');
}

interface ToolBlockProps {
  id: string;
  toolName: string;
  command: string;
  status: 'running' | 'success' | 'error';
  output?: string;
  duration?: string;
  kwargs?: Record<string, unknown>;
  onRevert: (id: string) => void;
}

function summarizeKwargs(command: string, kwargs?: Record<string, unknown>): string {
  if (!kwargs || Object.keys(kwargs).length === 0) return '';
  const cmd = kwargs.command;
  if (typeof cmd === 'string') return cmd;
  const path = kwargs.path ?? kwargs.file_path;
  if (typeof path === 'string') {
    const pattern = kwargs.pattern ?? kwargs.old_string;
    if (typeof pattern === 'string') {
      const short = pattern.length > 40 ? pattern.slice(0, 40) + '…' : pattern;
      return `${path}  "${short}"`;
    }
    return path;
  }
  const pattern = kwargs.pattern;
  if (typeof pattern === 'string') {
    const scope = kwargs.path ?? kwargs.include ?? kwargs.glob;
    return typeof scope === 'string' ? `"${pattern}" in ${scope}` : `"${pattern}"`;
  }
  const message = kwargs.message;
  if (typeof message === 'string') return message.length > 60 ? message.slice(0, 60) + '…' : message;
  const entries = Object.entries(kwargs).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
  if (entries.length === 0) return '';
  return entries.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ');
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  grep_search: <Search size={14} className="text-blue-400" />,
  grep: <Search size={14} className="text-blue-400" />,
  'search grep': <Search size={14} className="text-blue-400" />,
  'search glob': <FolderSearch size={14} className="text-cyan-400" />,
  glob_search: <FolderSearch size={14} className="text-cyan-400" />,
  read_file: <FileText size={14} className="text-emerald-400" />,
  'file read': <FileText size={14} className="text-emerald-400" />,
  edit_file: <Wrench size={14} className="text-amber-400" />,
  'file edit': <Wrench size={14} className="text-amber-400" />,
  'file write': <Wrench size={14} className="text-amber-400" />,
  'shell run': <Terminal size={14} className="text-purple-400" />,
  bash: <Terminal size={14} className="text-purple-400" />,
  'git status': <GitBranch size={14} className="text-orange-400" />,
  'git diff': <GitBranch size={14} className="text-orange-400" />,
  'git log': <GitBranch size={14} className="text-orange-400" />,
  'git commit': <GitBranch size={14} className="text-orange-400" />,
  'workspace diagnostics': <AlertTriangle size={14} className="text-yellow-400" />,
  web_search: <Globe size={14} className="text-teal-400" />,
};

export const ToolBlock: React.FC<ToolBlockProps> = ({ id, toolName, command, status, output, duration, kwargs, onRevert }) => {
  const autoExpand = AUTO_EXPAND_TOOLS.has(toolName) || AUTO_EXPAND_TOOLS.has(command);
  const [isExpanded, setIsExpanded] = useState(autoExpand);

  const icon = TOOL_ICONS[toolName] || TOOL_ICONS[command] || <Terminal size={14} className="text-zinc-400" />;

  const cleanOutput = useMemo(() => (output ? stripAnsi(output) : ''), [output]);

  const statusIcon = (() => {
    if (status === 'running') return <Loader2 size={14} className="text-zinc-400 animate-spin" />;
    if (status === 'success') return <Check size={14} className="text-emerald-500" />;
    if (status === 'error') return <AlertTriangle size={14} className="text-red-400" />;
    return null;
  })();

  const displayName = toolName?.replace(/_/g, ' ') || 'tool';
  const detail = summarizeKwargs(command, kwargs);

  return (
    <div className="px-6 py-2 ml-4 border-l-2 border-zinc-800/60 my-1 group relative fade-in">
      <ActionMenu content={command + '\n' + (output || '')} onRevert={onRevert} id={id} role="assistant" />

      <div
        className="flex items-center gap-3 cursor-pointer select-none bg-zinc-900/40 hover:bg-zinc-800/60 p-2 rounded-md border border-zinc-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-center w-5 h-5 text-zinc-500">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          {icon}
          <span className="text-xs font-semibold text-zinc-300 bg-zinc-800/80 px-2 py-0.5 rounded uppercase tracking-wider">
            {displayName}
          </span>
          <span className="text-sm text-zinc-500 font-mono truncate">{detail || command}</span>
        </div>

        <div className="flex items-center gap-3 pl-2 pr-8 group-hover:pr-24 transition-all">
          {duration && <span className="text-xs text-zinc-600 font-mono">{duration}</span>}
          {statusIcon}
        </div>
      </div>

      {isExpanded && output && (
        <div className="mt-2 ml-8 mr-4 mb-2">
          <div className="bg-[#0c0c0c] border border-zinc-800 rounded-md overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800">
              <span className="text-xs text-zinc-500 font-mono">Output</span>
              <span className="text-[10px] text-zinc-600 font-mono">
                {cleanOutput.split('\n').length} lines · {cleanOutput.length} chars
              </span>
            </div>
            <pre className="p-3 text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre leading-relaxed max-h-[480px] overflow-y-auto">
              <code>{cleanOutput}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
