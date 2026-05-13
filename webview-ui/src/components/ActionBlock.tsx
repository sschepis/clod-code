import React from 'react';
import {
  Search, Code, Shield, AlertTriangle, BookOpen,
  FileText, Lightbulb, Activity, Image, RefreshCw, Wrench,
} from 'lucide-react';

export interface ActionBlockProps {
  label: string;
  emoji: string;
  lines: Array<{ key: string; value: string }>;
}

export interface TraceBlockProps {
  items: Array<{ type: string; text: string }>;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  'workspace scan': <Search size={14} className="text-blue-400" />,
  'semantic analysis': <Search size={14} className="text-blue-400" />,
  'code generation': <Code size={14} className="text-amber-400" />,
  'constraint check': <Shield size={14} className="text-emerald-400" />,
  'dependency audit': <Shield size={14} className="text-emerald-400" />,
  'vulnerability check': <AlertTriangle size={14} className="text-yellow-400" />,
  'vulnerability simulation': <AlertTriangle size={14} className="text-yellow-400" />,
  'knowledge retrieval': <BookOpen size={14} className="text-purple-400" />,
  'data extraction': <BookOpen size={14} className="text-purple-400" />,
  'documentation': <FileText size={14} className="text-teal-400" />,
  'documentation auto-gen': <FileText size={14} className="text-teal-400" />,
  'hypothesis generation': <Lightbulb size={14} className="text-amber-400" />,
  'computational correlation': <Activity size={14} className="text-cyan-400" />,
  'visualization render': <Image size={14} className="text-pink-400" />,
  'architectural blueprinting': <Code size={14} className="text-indigo-400" />,
  'component synthesis': <Code size={14} className="text-amber-400" />,
  'file read check': <FileText size={14} className="text-emerald-400" />,
  'tool connectivity': <Activity size={14} className="text-cyan-400" />,
  'workspace write': <Wrench size={14} className="text-amber-400" />,
};

function getIcon(label: string): React.ReactNode {
  const lower = label.toLowerCase();
  return ACTION_ICONS[lower] || <Wrench size={14} className="text-vscode-desc" />;
}

function renderInlineCode(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-vscode-inputBg/60 px-1.5 py-0.5 rounded text-[0.85em] text-vscode-editorFg font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export const ActionBlock: React.FC<ActionBlockProps> = ({ label, emoji, lines }) => {
  const icon = getIcon(label);

  return (
    <div className="py-1.5 my-1 fade-in">
      <div className="flex items-center gap-2 bg-vscode-widgetBg/40 hover:bg-vscode-inputBg/60 p-2 rounded-md border border-vscode-panelBorder/50 transition-colors">
        {icon}
        <span className="text-xs font-semibold text-vscode-editorFg bg-vscode-inputBg/80 px-2 py-0.5 rounded uppercase tracking-wider">
          {label}
        </span>
        {emoji && <span className="text-sm">{emoji}</span>}
      </div>
      {lines.length > 0 && (
        <div className="mt-1.5 ml-6 space-y-0.5">
          {lines.map((line, i) => (
            <div key={i} className="text-[13px] text-vscode-desc leading-relaxed">
              <span className="font-semibold text-vscode-editorFg/80">{line.key}:</span>{' '}
              {renderInlineCode(line.value)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const TraceBlock: React.FC<TraceBlockProps> = ({ items }) => {
  return (
    <div className="py-1.5 my-1 fade-in">
      <div className="flex items-center gap-2 bg-orange-500/10 hover:bg-orange-500/15 p-2 rounded-md border border-orange-500/20 transition-colors">
        <RefreshCw size={14} className="text-orange-400" />
        <span className="text-xs font-semibold text-orange-300 bg-orange-500/15 px-2 py-0.5 rounded uppercase tracking-wider">
          Validation Trace
        </span>
      </div>
      {items.length > 0 && (
        <div className="mt-1.5 ml-6 space-y-0.5">
          {items.map((item, i) => (
            <div key={i} className="text-[13px] text-vscode-desc leading-relaxed">
              <span className="font-semibold text-orange-300/80 italic">{item.type}:</span>{' '}
              <span className="italic">{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
