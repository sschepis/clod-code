import React from 'react';
import { User, Sparkles, Terminal } from 'lucide-react';
import { ActionMenu } from './ActionMenu';
import { MarkdownContent, stripToolCallText } from './MarkdownContent';
import { ToolResultBlock } from './ToolResultBlock';

interface MessageBubbleProps {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  attachments?: any[];
  model?: string;
  onRevert: (id: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ id, role, content, timestamp, model, attachments, onRevert }) => {
  const isUser = role === 'user';

  let isToolResult = false;
  let toolName = '';
  let toolOutput = '';

  if (isUser) {
    const match = content.match(/^\[Tool result \((.*?)\): ([\s\S]*?)\]\s*$/);
    if (match) {
      isToolResult = true;
      toolName = match[1];
      toolOutput = match[2];
    }
  }

  if (!isUser && !stripToolCallText(content)) return null;

  return (
    <div className={`group relative flex gap-4 px-6 py-5 border-b border-zinc-800/50 transition-colors ${
      isUser ? (isToolResult ? 'bg-transparent hover:bg-zinc-900/30' : 'bg-zinc-900/50 hover:bg-zinc-900/80') : 'bg-transparent hover:bg-zinc-900/30'
    }`}>
      <ActionMenu content={content} onRevert={onRevert} id={id} />

      <div className="flex-shrink-0 mt-1">
        {isToolResult ? (
          <div className="w-8 h-8 rounded-full bg-zinc-800/50 text-zinc-400 flex items-center justify-center border border-zinc-700/50">
            <Terminal size={14} />
          </div>
        ) : isUser ? (
          <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center border border-amber-500/30">
            <User size={16} strokeWidth={2.5} />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
            <Sparkles size={16} strokeWidth={2.5} />
          </div>
        )}
      </div>

      <div className="flex-1 space-y-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-200">{isToolResult ? 'System' : isUser ? 'You' : 'Agent'}</span>
            {model && <span className="text-[10px] font-mono text-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 rounded">{model}</span>}
          </div>
          {timestamp && <span className="text-xs text-zinc-500">{timestamp}</span>}
        </div>
        {isUser ? (
          isToolResult ? (
            <ToolResultBlock toolName={toolName} output={toolOutput} />
          ) : (
            <div className="text-zinc-300 leading-relaxed whitespace-pre-wrap font-sans">
              {content}
              {attachments && attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-md py-1 px-2 text-xs text-zinc-300">
                      {att.type === 'image' ? (
                        <div className="flex items-center gap-1.5">
                          {att.url && <img src={att.url} alt="attachment" className="w-4 h-4 object-cover rounded-sm" />}
                          <span className="max-w-[150px] truncate">{att.name}</span>
                        </div>
                      ) : (
                        <span className="max-w-[150px] truncate">📄 {att.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="text-zinc-200 leading-relaxed font-sans markdown-body">
            <MarkdownContent content={content} />
          </div>
        )}
      </div>
    </div>
  );
};
