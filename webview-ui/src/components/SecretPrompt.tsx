import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, Check, X } from 'lucide-react';

interface SecretPromptProps {
  promptId: string;
  name: string;
  description?: string;
  envPath: string;
  status: 'pending' | 'answered' | 'cancelled';
  savedToFile?: boolean;
  onRespond: (promptId: string, response: { cancelled?: boolean; value?: string; saveToFile?: boolean }) => void;
}

export const SecretPrompt: React.FC<SecretPromptProps> = ({
  promptId,
  name,
  description,
  envPath,
  status,
  savedToFile,
  onRespond,
}) => {
  const [value, setValue] = useState('');
  const [saveToFile, setSaveToFile] = useState(true);
  const [revealed, setRevealed] = useState(false);

  if (status === 'answered') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-zinc-800/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <Check size={14} className="text-emerald-400" />
          <span className="text-zinc-400">Secret provided:</span>
          <span className="font-mono text-zinc-200">{name}</span>
          <span className="text-zinc-500">
            {savedToFile ? '— saved to .env' : '— session only'}
          </span>
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="px-6 py-2 ml-4 border-l-2 border-zinc-800/60 my-1 fade-in">
        <div className="flex items-center gap-2 text-xs">
          <X size={14} className="text-zinc-500" />
          <span className="text-zinc-500">Secret request cancelled</span>
          <span className="font-mono text-zinc-600">{name}</span>
        </div>
      </div>
    );
  }

  const submit = () => {
    if (!value) return;
    onRespond(promptId, { value, saveToFile });
  };

  return (
    <div className="px-6 py-3 ml-4 border-l-2 border-amber-500/40 my-2 fade-in">
      <div className="bg-zinc-900/60 border border-amber-500/20 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-amber-400" />
          <span className="text-sm font-medium text-amber-300">Secret Requested</span>
        </div>

        <div className="text-sm">
          <div className="text-zinc-200">
            <span className="font-mono text-amber-400/90 bg-amber-400/10 px-1.5 py-0.5 rounded">{name}</span>
          </div>
          {description && (
            <p className="mt-1.5 text-zinc-400">{description}</p>
          )}
        </div>

        <div className="relative">
          <input
            type={revealed ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value) submit();
              if (e.key === 'Escape') onRespond(promptId, { cancelled: true });
            }}
            placeholder="Enter secret value"
            autoFocus
            className="w-full px-3 py-2 pr-9 text-sm font-mono bg-zinc-950 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-amber-500/50"
          />
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            aria-label={revealed ? 'Hide' : 'Show'}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={saveToFile}
            onChange={(e) => setSaveToFile(e.target.checked)}
            className="accent-amber-500"
          />
          <span>
            Save to <span className="font-mono text-zinc-300">{envPath}</span>
          </span>
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={!value}
            className="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded transition-colors"
          >
            Submit
          </button>
          <button
            onClick={() => onRespond(promptId, { cancelled: true })}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
