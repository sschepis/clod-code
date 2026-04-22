import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Check, Lock } from 'lucide-react';
import type { PickerProviderInfo } from '../../../src/shared/message-types';

interface ModelPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectModel: (provider: string, model: string) => void;
  currentProvider: string;
  currentModel: string;
  providers: PickerProviderInfo[];
  targetRole?: 'triage' | 'executor';
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  isOpen, onClose, onSelectModel, currentProvider, currentModel, providers, targetRole,
}) => {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) setExpandedProvider(currentProvider);
  }, [isOpen, currentProvider]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const configured = providers.filter(p => p.configured);
  const unconfigured = providers.filter(p => !p.configured);

  const sortedConfigured = targetRole === 'triage'
    ? [...configured].sort((a, b) => (a.isLocal === b.isLocal ? 0 : a.isLocal ? -1 : 1))
    : configured;

  const headerText = targetRole === 'triage' ? 'Switch Triage Model' : 'Switch Executor Model';

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={ref}
        className="absolute right-0 top-full mt-1 w-72 bg-vscode-widgetBg border border-vscode-widgetBorder rounded-lg shadow-xl z-50 overflow-hidden"
      >
        <div className="px-3 py-2 text-xs font-semibold text-vscode-desc bg-vscode-editorBg border-b border-vscode-panelBorder">
          {headerText}
        </div>
        <div role="listbox" aria-label={headerText} className="max-h-[400px] overflow-y-auto py-1">
          {sortedConfigured.map(provider => {
            const isActive = currentProvider === provider.name;
            const isExpanded = expandedProvider === provider.name;
            return (
              <div key={provider.name} role="group" aria-label={provider.displayName}>
                <button
                  onClick={() => setExpandedProvider(isExpanded ? null : provider.name)}
                  aria-expanded={isExpanded}
                  className={`w-full px-3 py-2 flex items-center gap-2 text-sm hover:bg-vscode-inputBg transition-colors ${
                    isActive ? 'text-emerald-400' : 'text-vscode-editorFg'
                  }`}
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <span className="font-medium">{provider.displayName}</span>
                  {provider.isLocal && (
                    <span className="text-[10px] text-vscode-disabled">(local)</span>
                  )}
                  {isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  )}
                </button>
                {isExpanded && (
                  <div className="pl-7 pb-1">
                    {provider.models.map(model => {
                      const isCurrent = isActive && currentModel === model;
                      return (
                        <button
                          key={model}
                          role="option"
                          aria-selected={isCurrent}
                          onClick={() => onSelectModel(provider.name, model)}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-vscode-inputBg rounded transition-colors flex items-center gap-2 ${
                            isCurrent
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : 'text-vscode-desc'
                          }`}
                        >
                          <span className="truncate">{model}</span>
                          {isCurrent && (
                            <Check size={12} className="text-emerald-500 flex-shrink-0 ml-auto" />
                          )}
                        </button>
                      );
                    })}
                    {provider.models.length === 0 && (
                      <div className="px-3 py-1.5 text-xs text-vscode-disabled italic">
                        No models available
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {unconfigured.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-vscode-disabled uppercase tracking-wider border-t border-vscode-panelBorder mt-1">
                Not Configured
              </div>
              {unconfigured.map(provider => (
                <div
                  key={provider.name}
                  className="px-3 py-2 text-xs text-vscode-disabled flex items-center gap-2"
                >
                  <Lock size={12} className="flex-shrink-0" />
                  <span>{provider.displayName}</span>
                  <span className="text-vscode-disabled ml-auto text-[10px]">Add key in Settings</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
};
