import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, Zap, Map, FileText, X, Square, Mic, MicOff, Loader2 } from 'lucide-react';
import { SlashCommandMenu } from './SlashCommandMenu';
import { postMessage } from '../vscode-api';
import type { Attachment, SlashCommandInfo } from '../../../src/shared/message-types';

type RecordingState = 'idle' | 'recording' | 'transcribing';

interface InputAreaProps {
  onSubmit: (text: string, attachments: Attachment[], mode: 'act' | 'plan') => void;
  onInterrupt: () => void;
  isProcessing: boolean;
  mode: 'act' | 'plan';
  onModeChange: (mode: 'act' | 'plan') => void;
  slashCommands: SlashCommandInfo[];
  activeModel: string;
  disabled?: boolean;
  disabledReason?: string;
  recordingState?: RecordingState;
  recordingError?: string | null;
  pendingTranscript?: string | null;
  onTranscriptConsumed?: () => void;
}

export const InputArea: React.FC<InputAreaProps> = ({
  onSubmit, onInterrupt, isProcessing, mode, onModeChange, slashCommands, activeModel,
  disabled, disabledReason, recordingState = 'idle', recordingError, pendingTranscript, onTranscriptConsumed,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showSlashCommands, setShowSlashCommands] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);

  useEffect(() => {
    if (!isProcessing) setIsInterrupting(false);
  }, [isProcessing]);

  const handleInterrupt = () => {
    setIsInterrupting(true);
    onInterrupt();
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRecordingTextRef = useRef('');

  const isListening = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';

  const toggleRecording = () => {
    if (isListening) {
      postMessage({ type: 'stop_recording' });
    } else {
      preRecordingTextRef.current = inputValue;
      postMessage({ type: 'start_recording' });
    }
  };

  useEffect(() => {
    if (pendingTranscript) {
      const base = preRecordingTextRef.current || inputValue;
      const separator = base && !base.endsWith(' ') ? ' ' : '';
      const next = base + separator + pendingTranscript;
      setInputValue(next);
      preRecordingTextRef.current = next;
      onTranscriptConsumed?.();
    }
  }, [pendingTranscript]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue, attachments]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setShowSlashCommands(val.startsWith('/'));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const url = event.target?.result as string;
            setAttachments(prev => [...prev, {
              id: Date.now() + i,
              type: 'image',
              name: file.name || 'image.png',
              url,
            }]);
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }

    const text = e.clipboardData.getData('text');
    if (text && text.length > 500) {
      e.preventDefault();
      setAttachments(prev => [...prev, {
        id: Date.now(),
        type: 'text',
        name: 'pasted_text.txt',
        content: text,
      }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      if (isProcessing && !isInterrupting) {
        handleInterrupt();
      }
      setShowSlashCommands(false);
    }
  };

  const handleSend = () => {
    if (!inputValue.trim() && attachments.length === 0) return;
    onSubmit(inputValue, attachments, mode);
    setInputValue('');
    setAttachments([]);
    setShowSlashCommands(false);
  };

  const handleSlashSelect = (command: string) => {
    setInputValue(`/${command} `);
    setShowSlashCommands(false);
    textareaRef.current?.focus();
  };

  const removeAttachment = (id: number) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  if (disabled) {
    return (
      <div className="relative p-4 bg-vscode-editorBg border-t border-vscode-panelBorder z-20">
        <div className="bg-vscode-widgetBg/60 border border-vscode-panelBorder rounded-lg px-4 py-3 text-xs text-vscode-desc text-center">
          {disabledReason ?? 'Input is disabled'}
        </div>
      </div>
    );
  }

  return (
    <div className="relative p-4 bg-vscode-editorBg border-t border-vscode-panelBorder shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
      {/* Slash command menu */}
      {showSlashCommands && (
        <SlashCommandMenu
          commands={slashCommands}
          filter={inputValue}
          onSelect={handleSlashSelect}
        />
      )}

      <div className="flex flex-col gap-3">
        {/* Input wrapper */}
        <div className="relative flex flex-col bg-vscode-widgetBg border border-vscode-widgetBorder rounded-lg focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-500 transition-shadow overflow-hidden">

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1">
              {attachments.map(att => (
                <div key={att.id} className="flex items-center gap-2 bg-vscode-inputBg border border-vscode-widgetBorder rounded-md py-1 pl-2 pr-1 text-xs text-vscode-editorFg">
                  {att.type === 'image' ? (
                    <div className="flex items-center gap-1.5">
                      {att.url && <img src={att.url} alt="pasted" className="w-4 h-4 object-cover rounded-sm" />}
                      <span className="max-w-[100px] truncate">{att.name}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <FileText size={14} className="text-blue-400" />
                      <span className="max-w-[100px] truncate">{att.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="p-0.5 hover:bg-vscode-hoverBg rounded-md text-vscode-desc hover:text-vscode-editorFg transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <div className="relative flex items-end">
            <div className="absolute left-4 bottom-3.5 text-vscode-desc">
              <ArrowRight size={16} />
            </div>

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              aria-label="Message input"
              placeholder={isInterrupting
                ? "Stopping agent..."
                : isProcessing
                ? "Agent is working... press Esc to interrupt"
                : "Give the agent a command, type '/' for actions, or paste images/logs..."
              }
              className="w-full bg-transparent border-none py-3.5 pl-12 pr-40 text-sm text-vscode-editorFg placeholder-zinc-500 focus:outline-none focus:ring-0 resize-none max-h-[200px]"
              style={{ scrollbarWidth: 'thin' }}
            />

            {/* Mode toggle + Stop button */}
            <div role="toolbar" aria-label="Input actions" className="absolute right-2 bottom-2 flex items-center gap-1.5 p-1 bg-vscode-widgetBg rounded-md z-10">
              {isProcessing && (
                <button
                  onClick={handleInterrupt}
                  disabled={isInterrupting}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors shadow-sm ${
                    isInterrupting
                      ? 'bg-red-900/50 text-red-200 cursor-not-allowed shadow-none'
                      : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/50'
                  }`}
                  title="Stop the agent (Esc)"
                >
                  {isInterrupting ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} fill="currentColor" />}
                  {isInterrupting ? 'Stopping...' : 'Stop'}
                </button>
              )}
              <button
                onClick={toggleRecording}
                disabled={isTranscribing}
                className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                  isTranscribing
                    ? 'text-amber-400 cursor-wait'
                    : isListening
                    ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30 recording-pulse'
                    : 'text-vscode-desc hover:text-vscode-editorFg hover:bg-vscode-inputBg'
                }`}
                title={isTranscribing ? 'Transcribing...' : isListening ? 'Stop recording' : 'Start voice input'}
              >
                {isTranscribing ? <Loader2 size={14} className="animate-spin" /> : isListening ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
              <div className="flex bg-vscode-editorBg rounded-md p-0.5 border border-vscode-panelBorder">
                <button
                  onClick={() => onModeChange('plan')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    mode === 'plan' ? 'bg-vscode-inputBg text-vscode-editorFg shadow-sm' : 'text-vscode-desc hover:text-vscode-editorFg'
                  }`}
                >
                  <Map size={12} className={mode === 'plan' ? 'text-blue-400' : ''} /> Plan
                </button>
                <button
                  onClick={() => onModeChange('act')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    mode === 'act' ? 'bg-vscode-inputBg text-vscode-editorFg shadow-sm' : 'text-vscode-desc hover:text-vscode-editorFg'
                  }`}
                >
                  <Zap size={12} className={mode === 'act' ? 'text-amber-400' : ''} /> Act
                </button>
              </div>
            </div>
          </div>
        </div>

        {recordingError && (
          <div className="text-xs text-red-400 px-1 -mt-1">
            Voice input: {recordingError}
          </div>
        )}

        {/* Footer metadata */}
        <div className="flex justify-between items-center text-xs text-vscode-disabled px-1">
          <div className="flex items-center gap-4">
            <span>Model: {activeModel}</span>
            {isTranscribing ? (
              <span className="flex items-center gap-1.5 text-amber-400">
                <Loader2 size={10} className="animate-spin" />
                Transcribing...
              </span>
            ) : isListening ? (
              <span className="flex items-center gap-1.5 text-red-400">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 recording-pulse" />
                Recording...
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <kbd className="bg-vscode-inputBg border border-vscode-widgetBorder rounded px-1.5 py-0.5 text-[10px] font-sans">Enter</kbd> to send
              </span>
            )}
          </div>
          <span className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Workspace Connected
          </span>
        </div>
      </div>
    </div>
  );
};
