import React from 'react';
import { GitBranch, Monitor, Cloud } from 'lucide-react';
import type { RoutingMode } from '../../../src/shared/message-types';

const MODES: RoutingMode[] = ['dual', 'local-only', 'remote-only'];

const MODE_META: Record<RoutingMode, { icon: typeof GitBranch; label: string; tip: string }> = {
  'dual':        { icon: GitBranch, label: 'Dual',       tip: 'Dual: triage locally, execute remotely' },
  'local-only':  { icon: Monitor,   label: 'Local',      tip: 'Local only: nothing leaves your machine' },
  'remote-only': { icon: Cloud,     label: 'Remote',     tip: 'Remote only: skip local triage' },
};

interface RoutingModeToggleProps {
  mode: RoutingMode;
  onChange: (mode: RoutingMode) => void;
}

const RoutingModeToggle: React.FC<RoutingModeToggleProps> = ({ mode, onChange }) => {
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  const cycle = () => {
    const idx = MODES.indexOf(mode);
    onChange(MODES[(idx + 1) % MODES.length]);
  };

  return (
    <button
      onClick={cycle}
      title={meta.tip}
      className="flex items-center gap-1 px-1.5 py-1 rounded border border-vscode-panelBorder text-vscode-desc hover:text-vscode-editorFg hover:border-vscode-widgetBorder transition-colors text-[10px] font-medium uppercase tracking-wider"
    >
      <Icon size={12} />
      <span>{meta.label}</span>
    </button>
  );
};

export default RoutingModeToggle;
