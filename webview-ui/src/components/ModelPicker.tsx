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
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  isOpen, onClose, onSelectModel, currentProvider, currentModel, providers,
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

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={ref}
        className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden"
      >
        <div className="px-3 py-2 text-xs font-semibold text-zinc-500 bg-zinc-950 border-b border-zinc-800">
          Switch Model
        </div>
        <div className="max-h-[400px] overflow-y-auto py-1">
          {configured.map(provider => {
            const isActive = currentProvider === provider.name;
            const isExpanded = expandedProvider === provider.name;
            return (
              <div key={provider.name}>
                <button
                  onClick={() => setExpandedProvider(isExpanded ? null : provider.name)}
                  className={`w-full px-3 py-2 flex items-center gap-2 text-sm hover:bg-zinc-800 transition-colors ${
                    isActive ? 'text-emerald-400' : 'text-zinc-300'
                  }`}
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <span className="font-medium">{provider.displayName}</span>
                  {provider.isLocal && (
                    <span className="text-[10px] text-zinc-600">(local)</span>
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
                          onClick={() => onSelectModel(provider.name, model)}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 rounded transition-colors flex items-center gap-2 ${
                            isCurrent
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : 'text-zinc-400'
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
                      <div className="px-3 py-1.5 text-xs text-zinc-600 italic">
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
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider border-t border-zinc-800 mt-1">
                Not Configured
              </div>
              {unconfigured.map(provider => (
                <div
                  key={provider.name}
                  className="px-3 py-2 text-xs text-zinc-600 flex items-center gap-2"
                >
                  <Lock size={12} className="flex-shrink-0" />
                  <span>{provider.displayName}</span>
                  <span className="text-zinc-700 ml-auto text-[10px]">Add key in Settings</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
};
