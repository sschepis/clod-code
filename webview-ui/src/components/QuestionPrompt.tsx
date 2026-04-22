import React, { useState } from 'react';
import { HelpCircle, Check, X } from 'lucide-react';

interface QuestionPromptProps {
  promptId: string;
  question: string;
  choices: string[];
  defaultChoice?: number;
  inputMode?: 'choice' | 'text';
  status: 'pending' | 'answered' | 'cancelled';
  answerIndex?: number;
  answerText?: string;
  onRespond: (promptId: string, response: { cancelled?: boolean; answerIndex?: number; answerText?: string }) => void;
}

export const QuestionPrompt: React.FC<QuestionPromptProps> = ({
  promptId,
  question,
  choices,
  defaultChoice,
  inputMode,
  status,
  answerIndex,
  answerText,
  onRespond,
}) => {
  const mode = inputMode ?? 'choice';
  const [selected, setSelected] = useState<number>(defaultChoice ?? 0);
  const [textValue, setTextValue] = useState<string>('');

  if (status === 'answered') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <Check size={14} className="text-emerald-400" />
          <span className="text-vscode-desc">Answered:</span>
          <span className="text-vscode-editorFg">{answerText ?? (answerIndex !== undefined ? choices[answerIndex] : '')}</span>
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-vscode-panelBorder/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <X size={14} className="text-vscode-desc" />
          <span className="text-vscode-desc">Question cancelled</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-3 ml-4 border-l-2 border-sky-500/40 my-2 fade-in">
      <div role="alertdialog" aria-label="Question from agent" aria-describedby={`q-desc-${promptId}`} className="bg-vscode-widgetBg/60 border border-sky-500/20 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HelpCircle size={16} className="text-sky-400" />
          <span className="text-sm font-medium text-sky-300">Question</span>
        </div>

        <div id={`q-desc-${promptId}`} className="text-sm text-vscode-editorFg whitespace-pre-wrap">{question}</div>

        {mode === 'text' ? (
          <textarea
            autoFocus
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && textValue.trim()) {
                onRespond(promptId, { answerText: textValue });
              } else if (e.key === 'Escape') {
                onRespond(promptId, { cancelled: true });
              }
            }}
            placeholder="Type your answer — ⌘/Ctrl-Enter to submit"
            rows={3}
            className="w-full px-2.5 py-1.5 text-sm bg-vscode-editorBg border border-vscode-panelBorder rounded text-vscode-editorFg focus:outline-none focus:border-sky-500/50 font-sans"
          />
        ) : (
          <div className="space-y-1.5">
            {choices.map((choice, i) => (
              <label
                key={i}
                className={`flex items-start gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-colors ${
                  selected === i ? 'bg-sky-500/10 border border-sky-500/30' : 'border border-transparent hover:bg-vscode-inputBg/60'
                }`}
              >
                <input
                  type="radio"
                  name={`q-${promptId}`}
                  checked={selected === i}
                  onChange={() => setSelected(i)}
                  className="mt-0.5 accent-sky-500"
                />
                <span className="text-sm text-vscode-editorFg flex-1">{choice}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => {
              if (mode === 'text') {
                if (!textValue.trim()) return;
                onRespond(promptId, { answerText: textValue });
              } else {
                onRespond(promptId, { answerIndex: selected, answerText: choices[selected] });
              }
            }}
            disabled={mode === 'text' && !textValue.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:bg-vscode-inputBg disabled:text-vscode-desc text-white rounded transition-colors"
          >
            Submit
          </button>
          <button
            onClick={() => onRespond(promptId, { cancelled: true })}
            className="px-3 py-1.5 text-xs font-medium bg-vscode-inputBg hover:bg-vscode-hoverBg text-vscode-editorFg rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
