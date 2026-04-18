import React, { useCallback, useState } from 'react';
import { Terminal, AlertTriangle, ArrowLeft, Bot, MessageSquare, FolderTree, ChevronDown } from 'lucide-react';
import { ChatPanel } from './components/ChatPanel';
import { InputArea } from './components/InputArea';
import { CostBadge } from './components/CostBadge';
import { AgentStrip } from './components/AgentStrip';
import { PeersStrip } from './components/PeersStrip';
import { OutboundDispatchesStrip } from './components/OutboundDispatchesStrip';
import { ObjectManagerView } from './components/ObjectManagerView';
import { ModelPicker } from './components/ModelPicker';
import { useMessages } from './hooks/useMessages';
import { useVsCode } from './hooks/useVsCode';
import { postMessage } from './vscode-api';
import type { ExtToWebviewMessage, PickerProviderInfo } from '../../src/shared/message-types';
import { FOREGROUND_AGENT_ID } from '../../src/shared/message-types';

const PANEL_AGENT_ID = (typeof window !== 'undefined' && (window as any).__CLODCODE_PANEL_AGENT_ID__) as string | undefined;
const isPanelMode = !!PANEL_AGENT_ID;

export default function App() {
  const {
    state,
    focusedSlice,
    isProcessing,
    aggregateCost,
    agentList,
    appendToken,
    addEvent,
    updateToolStatus,
    updatePermissionStatus,
    updateQuestionStatus,
    updateSecretStatus,
    updatePeerDispatchStatus,
    sync,
    syncAgents,
    setPhase,
    setCost,
    setModel,
    setMode,
    setSlashCommands,
    clearEvents,
    clearStaleErrors,
    revertTo,
    upsertAgent,
    patchAgent,
    removeAgent,
    setFocus,
    setPeers,
    setOutboundDispatches,
    setObjects,
    setSyncMetrics,
  } = useMessages();

  const focusedAgentId = state.focusedAgentId;

  const handleExtMessage = useCallback((msg: ExtToWebviewMessage) => {
    // Most per-agent messages carry an optional `agentId`; default to foreground.
    const aid = (msg as any).agentId ?? FOREGROUND_AGENT_ID;

    switch (msg.type) {
      case 'sync':
        sync(aid, msg.events, msg.phase, msg.cost, msg.activeModel, msg.mode);
        if (msg.agents) {
          syncAgents(msg.agents, msg.focusedAgentId ?? FOREGROUND_AGENT_ID);
        }
        break;
      case 'event':
        addEvent(aid, msg.event);
        break;
      case 'token':
        appendToken(aid, msg.text, msg.eventId);
        break;
      case 'phase':
        setPhase(aid, { phase: msg.phase, message: msg.message });
        break;
      case 'cost_update':
        setCost(aid, msg.cost);
        break;
      case 'model_changed':
        setModel(aid, msg.model);
        break;
      case 'tool_status':
        updateToolStatus(aid, msg.eventId, msg.status, msg.output, msg.duration);
        break;
      case 'permission_request':
        addEvent(aid, {
          id: msg.eventId,
          role: 'permission',
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          description: msg.description,
          status: 'pending',
          timestamp: now(),
        });
        break;
      case 'permission_resolved':
        updatePermissionStatus(aid, msg.eventId, msg.status);
        break;
      case 'ask_question':
        addEvent(aid, {
          id: `question-${msg.promptId}`,
          role: 'question',
          promptId: msg.promptId,
          question: msg.question,
          choices: msg.choices,
          defaultChoice: msg.defaultChoice,
          inputMode: msg.inputMode,
          status: 'pending',
          timestamp: now(),
        });
        break;
      case 'ask_question_resolved':
        updateQuestionStatus(aid, msg.promptId, {
          status: msg.status,
          answerIndex: msg.answerIndex,
          answerText: msg.answerText,
        });
        break;
      case 'ask_secret':
        addEvent(aid, {
          id: `secret-${msg.promptId}`,
          role: 'secret_request',
          promptId: msg.promptId,
          name: msg.name,
          description: msg.description,
          envPath: msg.envPath,
          status: 'pending',
          timestamp: now(),
        });
        break;
      case 'ask_secret_resolved':
        updateSecretStatus(aid, msg.promptId, {
          status: msg.status,
          savedToFile: msg.savedToFile,
        });
        break;
      case 'peer_dispatch_request':
        addEvent(aid, {
          id: `peer-dispatch-${msg.promptId}`,
          role: 'peer_dispatch_request',
          promptId: msg.promptId,
          fromWindowId: msg.fromWindowId,
          task: msg.task,
          label: msg.label,
          status: 'pending',
          timestamp: now(),
        });
        break;
      case 'peer_dispatch_resolved':
        updatePeerDispatchStatus(aid, msg.promptId, msg.status);
        break;
      case 'clear':
        clearEvents(aid);
        break;
      case 'clear_stale_errors':
        clearStaleErrors(aid);
        break;
      case 'slash_commands':
        setSlashCommands(msg.commands);
        break;
      case 'agent_spawned':
        upsertAgent(msg.agent);
        break;
      case 'agent_status':
        patchAgent(msg.agentId, {
          status: msg.status,
          ...(msg.cost ? { cost: msg.cost } : {}),
          ...(msg.result !== undefined ? { result: msg.result } : {}),
          ...(msg.error !== undefined ? { error: msg.error } : {}),
          ...(msg.completedAt !== undefined ? { completedAt: msg.completedAt } : {}),
        });
        break;
      case 'agent_disposed':
        removeAgent(msg.agentId);
        break;
      case 'agents_sync':
        syncAgents(msg.agents, msg.focusedAgentId);
        break;
      case 'peers_update':
        setPeers(msg.peers);
        break;
      case 'outbound_dispatches_update':
        setOutboundDispatches(msg.dispatches);
        break;
      case 'objects_sync':
        setObjects(msg.snapshot);
        break;
      case 'sync_update':
        setSyncMetrics(msg.metrics);
        break;
      case 'provider_models':
        setPickerProviders(msg.providers);
        break;
    }
  }, [
    appendToken, addEvent, updateToolStatus, updatePermissionStatus,
    updateQuestionStatus, updateSecretStatus, updatePeerDispatchStatus, sync, syncAgents,
    setPhase, setCost, setModel, setSlashCommands, clearEvents, clearStaleErrors,
    upsertAgent, patchAgent, removeAgent, setPeers, setOutboundDispatches, setObjects, setSyncMetrics,
  ]);

  const {
    submit, interrupt, revert, changeModel,
    respondPermission, respondQuestion, respondSecret, respondPeerDispatch,
    focusAgent, cancelAgent, objectAction,
  } = useVsCode(handleExtMessage);

  // ── Handlers ──────────────────────────────────────────────────────

  const handleRevert = useCallback((eventId: string) => {
    revertTo(focusedAgentId, eventId);
    revert(eventId, focusedAgentId);
  }, [revertTo, revert, focusedAgentId]);

  const handleSubmit = useCallback((text: string, attachments: any[], mode: 'act' | 'plan') => {
    submit(text, attachments, mode, focusedAgentId);
  }, [submit, focusedAgentId]);

  const handleSetMode = useCallback((mode: 'act' | 'plan') => {
    setMode(focusedAgentId, mode);
  }, [setMode, focusedAgentId]);

  const handleFocusAgent = useCallback((agentId: string) => {
    setFocus(agentId);
    focusAgent(agentId);
  }, [setFocus, focusAgent]);

  const handleCancelAgent = useCallback((agentId: string) => {
    cancelAgent(agentId);
  }, [cancelAgent]);

  const focusedAgentSummary = state.agents[focusedAgentId];
  const viewingBackground = !isPanelMode && focusedAgentId !== FOREGROUND_AGENT_ID;

  const [activeView, setActiveView] = useState<'chat' | 'objects'>('chat');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerProviders, setPickerProviders] = useState<PickerProviderInfo[]>([]);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-[#121214] text-zinc-200 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-zinc-950 border-b border-zinc-800 z-20 shadow-sm shadow-black/20 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-3 h-3 rounded-full ${
            isProcessing
              ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] pulse-glow'
              : focusedSlice.activeModel.mismatch
              ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
              : focusedSlice.activeModel.ready === false
              ? 'bg-zinc-600'
              : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
          }`} />
          <h1 className="text-sm font-semibold tracking-wide text-zinc-100 flex items-center gap-2 min-w-0">
            <Terminal size={16} className="text-zinc-400 shrink-0" />
            Clodcode
            {viewingBackground && (
              <>
                <span className="text-zinc-600 mx-1">/</span>
                <button
                  onClick={() => handleFocusAgent(FOREGROUND_AGENT_ID)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                  title="Back to foreground"
                >
                  <ArrowLeft size={12} />
                </button>
                <span className="flex items-center gap-1 text-xs text-zinc-400 truncate max-w-[200px]">
                  <Bot size={12} className="text-indigo-400 shrink-0" />
                  <span className="truncate">{focusedAgentSummary?.label ?? focusedAgentId}</span>
                </span>
              </>
            )}
          </h1>
        </div>
        
        {/* Tab switcher (hidden in panel mode) */}
        {!isPanelMode && (
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded mx-2 shrink-0">
            <button
              onClick={() => setActiveView('chat')}
              className={`p-1.5 flex items-center gap-1.5 text-xs font-medium rounded-l transition-colors ${
                activeView === 'chat'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
              title="Chat View"
            >
              <MessageSquare size={14} />
            </button>
            <div className="w-px h-4 bg-zinc-800" />
            <button
              onClick={() => setActiveView('objects')}
              className={`p-1.5 flex items-center gap-1.5 text-xs font-medium rounded-r transition-colors ${
                activeView === 'objects'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
              title="Object Manager"
            >
              <FolderTree size={14} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 shrink-0">
          <CostBadge cost={aggregateCost} />

          <div className="relative">
            <button
              onClick={() => {
                if (!pickerOpen) {
                  postMessage({ type: 'request_provider_models' });
                }
                setPickerOpen(!pickerOpen);
              }}
              className={`text-xs font-mono px-2 py-1 rounded border flex items-center gap-1.5 cursor-pointer transition-colors ${
                focusedSlice.activeModel.mismatch
                  ? 'bg-red-900/40 border-red-700/50 text-red-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:border-zinc-600'
              }`}
              title="Click to switch model"
            >
              {focusedSlice.activeModel.mismatch && (
                <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
              )}
              <span className="text-zinc-500">
                {focusedSlice.activeModel.providerDisplayName ?? focusedSlice.activeModel.provider}
              </span>
              <span className="text-zinc-700">/</span>
              <span className={focusedSlice.activeModel.mismatch ? 'text-red-300' : 'text-zinc-300'}>
                {focusedSlice.activeModel.model}
              </span>
              <ChevronDown size={10} className="text-zinc-600 ml-0.5" />
            </button>
            <ModelPicker
              isOpen={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onSelectModel={(provider, model) => {
                changeModel(provider, model);
                setPickerOpen(false);
              }}
              currentProvider={focusedSlice.activeModel.provider}
              currentModel={focusedSlice.activeModel.model}
              providers={pickerProviders}
            />
          </div>
        </div>
      </header>

      {focusedSlice.activeModel.mismatch && focusedSlice.activeModel.mismatchReason && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-200 flex items-center gap-2 flex-shrink-0">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
          <span className="flex-1">{focusedSlice.activeModel.mismatchReason}</span>
        </div>
      )}

      {!isPanelMode && activeView === 'objects' ? (
        <div className="flex-1 overflow-hidden">
          <ObjectManagerView
            objects={state.objects}
            agents={agentList}
            focusedAgentId={focusedAgentId}
            onFocusAgent={(id) => {
              handleFocusAgent(id);
              setActiveView('chat');
            }}
            onCancelAgent={handleCancelAgent}
            onObjectAction={objectAction}
          />
        </div>
      ) : (
        <>
          {/* Chat area */}
          <ChatPanel
            events={focusedSlice.events}
            phase={focusedSlice.phase}
            isProcessing={isProcessing}
            onRevert={handleRevert}
            onPermissionRespond={(eventId, allowed, remember) =>
              respondPermission(eventId, allowed, remember, focusedAgentId)
            }
            onQuestionRespond={(promptId, response) => respondQuestion(promptId, response, focusedAgentId)}
            onSecretRespond={(promptId, response) => respondSecret(promptId, response, focusedAgentId)}
            onPeerDispatchRespond={(promptId, approved) => respondPeerDispatch(promptId, approved, focusedAgentId)}
          />

          {/* Peer windows strip (hidden in panel mode) */}
          {!isPanelMode && <PeersStrip peers={state.peers} />}

          {/* Outbound dispatches strip (hidden in panel mode) */}
          {!isPanelMode && <OutboundDispatchesStrip dispatches={state.outboundDispatches} />}

          {/* Background agents strip (hidden in panel mode) */}
          {!isPanelMode && (
            <AgentStrip
              agents={agentList}
              focusedAgentId={focusedAgentId}
              syncMetrics={state.syncMetrics}
              onFocus={handleFocusAgent}
              onCancel={handleCancelAgent}
            />
          )}

          {/* Input — disabled when viewing a background agent */}
          <InputArea
            onSubmit={handleSubmit}
            onInterrupt={() => interrupt(focusedAgentId)}
            isProcessing={isProcessing}
            mode={focusedSlice.mode}
            onModeChange={handleSetMode}
            slashCommands={state.slashCommands}
            activeModel={focusedSlice.activeModel.model}
            disabled={viewingBackground}
            disabledReason={viewingBackground ? 'Viewing a background agent — switch to foreground to submit new input.' : undefined}
          />
        </>
      )}
    </div>
  );
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
