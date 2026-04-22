import React from 'react';
import type { CostState } from '../../../src/shared/message-types';

interface CostBadgeProps {
  cost: CostState;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export const CostBadge: React.FC<CostBadgeProps> = ({ cost }) => {
  if (cost.totalTokens === 0) return null;

  return (
    <span className="flex items-center gap-1.5 text-vscode-desc">
      <span>{formatCost(cost.totalCost)}</span>
      <span className="text-vscode-disabled">|</span>
      <span>{formatTokens(cost.totalTokens)} tokens</span>
    </span>
  );
};
