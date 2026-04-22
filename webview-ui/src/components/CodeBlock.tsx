import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

function copyToClipboard(text: string) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Simple diff highlighting
  const isDiff = language === 'diff' || code.startsWith('---') || code.startsWith('+++');
  const lines = code.split('\n');

  return (
    <div className="my-2 bg-[#0c0c0c] border border-vscode-panelBorder rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-vscode-widgetBg/80 border-b border-vscode-panelBorder">
        <span className="text-xs text-vscode-desc font-mono">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="p-1 text-vscode-desc hover:text-vscode-editorFg transition-colors rounded"
          title="Copy code"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto leading-relaxed">
        {isDiff ? (
          lines.map((line, i) => {
            let className = 'text-vscode-editorFg';
            if (line.startsWith('+') && !line.startsWith('+++')) className = 'diff-add';
            else if (line.startsWith('-') && !line.startsWith('---')) className = 'diff-remove';
            else if (line.startsWith('@@')) className = 'diff-header';
            else if (line.startsWith('---') || line.startsWith('+++')) className = 'diff-header';
            return (
              <div key={i} className={className}>
                {line}
              </div>
            );
          })
        ) : (
          <code className="text-vscode-editorFg">{code}</code>
        )}
      </pre>
    </div>
  );
};
