import React from 'react';
import { ArrowRight } from 'lucide-react';

interface ToolNarrativeProps {
  content: string;
  iteration: number;
  totalToolCalls: number;
}

export const ToolNarrative: React.FC<ToolNarrativeProps> = ({ content, iteration, totalToolCalls }) => {
  return (
    <div className="px-6 py-2 ml-4 border-l-2 border-zinc-800/60 my-1 fade-in">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <ArrowRight size={12} className="text-zinc-600" />
        <span className="italic">{content}</span>
        <span className="ml-auto font-mono text-zinc-600">
          iter {iteration} | {totalToolCalls} call{totalToolCalls !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
};
