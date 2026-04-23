import { useState, useCallback, useMemo } from 'react';
import type {
  SessionEvent, PhaseState, CostState, ModelInfo, SlashCommandInfo, AgentSummary, AgentSyncMetrics, PeerUiSnapshot, OutboundDispatchUi,
  ObjectSnapshot, RoutingMode,
} from '../../../src/shared/message-types';
import { FOREGROUND_AGENT_ID } from '../../../src/shared/message-types';

/**
 * Per-agent UI slice. One of these per known agentId.
 */
export interface AgentUiSlice {
  events: SessionEvent[];
  phase: PhaseState;
  cost: CostState;
  activeModel: ModelInfo;
  triageModel?: ModelInfo;
  routingMode: RoutingMode;
  mode: 'act' | 'plan';
}

export interface AppState {
  slices: Record<string, AgentUiSlice>;
  agents: Record<string, AgentSummary>;
  focusedAgentId: string;
  slashCommands: SlashCommandInfo[];
  syncMetrics: Record<string, AgentSyncMetrics>;
  peers: PeerUiSnapshot[];
  outboundDispatches: OutboundDispatchUi[];
  objects: ObjectSnapshot;
}

const EMPTY_OBJECTS: ObjectSnapshot = {
  surfaces: [],
  routes: [],
  skills: [],
  memories: [],
  conversations: [],
  projects: [],
};

const DEFAULT_MODEL: ModelInfo = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  isLocal: false,
};

const DEFAULT_SLICE: AgentUiSlice = {
  events: [],
  phase: { phase: 'idle', message: '' },
  cost: { totalTokens: 0, totalCost: 0 },
  activeModel: DEFAULT_MODEL,
  routingMode: 'dual',
  mode: 'act',
};

const PANEL_AGENT_ID = (typeof window !== 'undefined' && (window as any).__OBOTOVS_PANEL_AGENT_ID__) as string | undefined;
const INITIAL_FOCUSED_ID = PANEL_AGENT_ID ?? FOREGROUND_AGENT_ID;

const INITIAL_STATE: AppState = {
  slices: {
    [INITIAL_FOCUSED_ID]: { ...DEFAULT_SLICE },
  },
  agents: {},
  syncMetrics: {},
  focusedAgentId: INITIAL_FOCUSED_ID,
  slashCommands: [
    { name: 'clear', summary: 'Clear session', icon: 'trash' },
    { name: 'model', summary: 'Switch model', icon: 'cpu' },
    { name: 'status', summary: 'Show status', icon: 'info' },
    { name: 'cost', summary: 'Show cost breakdown', icon: 'dollar' },
    { name: 'agents', summary: 'List background agents', icon: 'cpu' },
    { name: 'compact', summary: 'Compact session', icon: 'compress' },
    { name: 'help', summary: 'Show available commands', icon: 'help' },
    { name: 'diff', summary: 'Show git diff', icon: 'git' },
    { name: 'diagnostics', summary: 'Show workspace errors', icon: 'warning' },
    { name: 'peers', summary: 'List peer Oboto windows', icon: 'cpu' },
  ],
  peers: [],
  outboundDispatches: [],
  objects: EMPTY_OBJECTS,
};

function ensureSlice(state: AppState, agentId: string, seedModel?: ModelInfo, triageModel?: ModelInfo, routingMode?: RoutingMode): AgentUiSlice {
  const existing = state.slices[agentId];
  if (existing) return existing;
  const slice: AgentUiSlice = {
    ...DEFAULT_SLICE,
    activeModel: seedModel ?? DEFAULT_MODEL,
    triageModel,
    routingMode: routingMode ?? 'dual',
  };
  state.slices[agentId] = slice;
  return slice;
}

export function useMessages() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);

  // ── Derived helpers ────────────────────────────────────────────────

  const focusedSlice = useMemo<AgentUiSlice>(
    () => state.slices[state.focusedAgentId] ?? DEFAULT_SLICE,
    [state.slices, state.focusedAgentId],
  );

  const isProcessing = useMemo<boolean>(() => {
    const p = focusedSlice.phase.phase;
    return p !== 'idle' && p !== 'complete' && p !== 'error';
  }, [focusedSlice]);

  const aggregateCost = useMemo<CostState>(() => {
    let totalTokens = 0;
    let totalCost = 0;
    for (const slice of Object.values(state.slices)) {
      totalTokens += slice.cost.totalTokens;
      totalCost += slice.cost.totalCost;
    }
    return { totalTokens, totalCost };
  }, [state.slices]);

  const agentList = useMemo<AgentSummary[]>(
    () => Object.values(state.agents).sort((a, b) => a.createdAt - b.createdAt),
    [state.agents],
  );

  // ── Slice mutation helpers ─────────────────────────────────────────

  const appendToken = useCallback((agentId: string, text: string, eventId: string) => {
    setState(prev => {
      const slices = { ...prev.slices };
      const slice = { ...ensureSlice({ ...prev, slices }, agentId) };
      const events = [...slice.events];
      const lastIdx = events.length - 1;
      const last = events[lastIdx];
      if (last && last.id === eventId && last.role === 'assistant') {
        events[lastIdx] = { ...last, content: last.content + text };
      } else {
        events.push({
          id: eventId,
          role: 'assistant',
          content: text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }
      slices[agentId] = { ...slice, events };
      return { ...prev, slices };
    });
  }, []);

  const addEvent = useCallback((agentId: string, event: SessionEvent) => {
    setState(prev => {
      const slices = { ...prev.slices };
      const slice = ensureSlice({ ...prev, slices }, agentId);
      slices[agentId] = { ...slice, events: [...slice.events, event] };
      return { ...prev, slices };
    });
  }, []);

  const updateToolStatus = useCallback((
    agentId: string,
    eventId: string,
    status: 'running' | 'success' | 'error',
    output?: string,
    duration?: string,
  ) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.map(e => {
        if (e.id === eventId && e.role === 'tool') {
          return { ...e, status, ...(output !== undefined ? { output } : {}), ...(duration !== undefined ? { duration } : {}) };
        }
        return e;
      });
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  const updatePermissionStatus = useCallback((agentId: string, eventId: string, status: 'allowed' | 'denied') => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.map(e => (e.id === eventId && e.role === 'permission' ? { ...e, status } : e));
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  const updateQuestionStatus = useCallback((
    agentId: string,
    promptId: string,
    patch: { status: 'answered' | 'cancelled'; answerIndex?: number; answerText?: string },
  ) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.map(e =>
        e.role === 'question' && (e as any).promptId === promptId ? { ...e, ...patch } : e,
      );
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  const updateSecretStatus = useCallback((
    agentId: string,
    promptId: string,
    patch: { status: 'answered' | 'cancelled'; savedToFile?: boolean },
  ) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.map(e =>
        e.role === 'secret_request' && (e as any).promptId === promptId ? { ...e, ...patch } : e,
      );
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  const updatePeerDispatchStatus = useCallback((
    agentId: string,
    promptId: string,
    status: 'approved' | 'rejected',
  ) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.map(e =>
        e.role === 'peer_dispatch_request' && (e as any).promptId === promptId
          ? { ...e, status }
          : e,
      );
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  const updatePlanApprovalStatus = useCallback((
    agentId: string,
    promptId: string,
    patch: { status: 'approved' | 'denied'; approvalMode?: 'auto' | 'manual' },
  ) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.map(e =>
        e.role === 'plan_approval' && (e as any).promptId === promptId
          ? { ...e, ...patch }
          : e,
      );
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  const sync = useCallback((
    agentId: string,
    events: SessionEvent[],
    phase: PhaseState,
    cost: CostState,
    activeModel: ModelInfo,
    mode: 'act' | 'plan',
    triageModel?: ModelInfo,
    routingMode?: RoutingMode,
  ) => {
    setState(prev => {
      const slices = { ...prev.slices };
      slices[agentId] = { events, phase, cost, activeModel, triageModel, routingMode: routingMode ?? 'dual', mode };
      return { ...prev, slices };
    });
  }, []);

  const syncAgents = useCallback((agents: AgentSummary[], focusedAgentId: string) => {
    setState(prev => {
      const map: Record<string, AgentSummary> = {};
      for (const a of agents) map[a.id] = a;
      return { ...prev, agents: map, focusedAgentId };
    });
  }, []);

  const setPhase = useCallback((agentId: string, phase: PhaseState) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, phase } } };
    });
  }, []);

  const setCost = useCallback((agentId: string, cost: CostState) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, cost } } };
    });
  }, []);

  const setModel = useCallback((agentId: string, model: ModelInfo, triageModel?: ModelInfo, routingMode?: RoutingMode) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      return { ...prev, slices: { ...prev.slices, [agentId]: {
        ...slice,
        activeModel: model,
        ...(triageModel !== undefined ? { triageModel } : {}),
        ...(routingMode !== undefined ? { routingMode } : {}),
      } } };
    });
  }, []);

  const setMode = useCallback((agentId: string, mode: 'act' | 'plan') => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, mode } } };
    });
  }, []);

  const setSlashCommands = useCallback((commands: SlashCommandInfo[]) => {
    setState(prev => ({ ...prev, slashCommands: commands }));
  }, []);

  const clearEvents = useCallback((agentId: string) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      return {
        ...prev,
        slices: {
          ...prev.slices,
          [agentId]: { ...slice, events: [], phase: { phase: 'idle', message: '' } },
        },
      };
    });
  }, []);

  const clearStaleErrors = useCallback((agentId: string) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.filter(e => {
        if (e.role !== 'system') return true;
        const text = (e as any).content as string;
        return !(text?.includes('Failed to initialize agent') || text?.includes('API key required'));
      });
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  const revertTo = useCallback((agentId: string, eventId: string) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const idx = slice.events.findIndex(e => e.id === eventId);
      if (idx === -1) return prev;
      return {
        ...prev,
        slices: { ...prev.slices, [agentId]: { ...slice, events: slice.events.slice(0, idx + 1) } },
      };
    });
  }, []);

  const deleteEvent = useCallback((agentId: string, eventId: string) => {
    setState(prev => {
      const slice = prev.slices[agentId];
      if (!slice) return prev;
      const events = slice.events.filter(e => e.id !== eventId);
      return { ...prev, slices: { ...prev.slices, [agentId]: { ...slice, events } } };
    });
  }, []);

  // ── Agent summary mutators ─────────────────────────────────────────

  const upsertAgent = useCallback((summary: AgentSummary) => {
    setState(prev => ({ ...prev, agents: { ...prev.agents, [summary.id]: summary } }));
  }, []);

  const patchAgent = useCallback((agentId: string, patch: Partial<AgentSummary>) => {
    setState(prev => {
      const existing = prev.agents[agentId];
      if (!existing) return prev;
      return { ...prev, agents: { ...prev.agents, [agentId]: { ...existing, ...patch } } };
    });
  }, []);

  const removeAgent = useCallback((agentId: string) => {
    setState(prev => {
      const { [agentId]: _removed, ...rest } = prev.agents;
      const { [agentId]: _s, ...sliceRest } = prev.slices;
      void _removed;
      void _s;
      const focused = prev.focusedAgentId === agentId ? FOREGROUND_AGENT_ID : prev.focusedAgentId;
      return { ...prev, agents: rest, slices: sliceRest, focusedAgentId: focused };
    });
  }, []);

  const setFocus = useCallback((agentId: string) => {
    setState(prev => ({ ...prev, focusedAgentId: agentId }));
  }, []);

  const setPeers = useCallback((peers: PeerUiSnapshot[]) => {
    setState(prev => ({ ...prev, peers }));
  }, []);

  const setOutboundDispatches = useCallback((outboundDispatches: OutboundDispatchUi[]) => {
    setState(prev => ({ ...prev, outboundDispatches }));
  }, []);

  const setObjects = useCallback((objects: ObjectSnapshot) => {
    setState(prev => ({ ...prev, objects }));
  }, []);

  const setSyncMetrics = useCallback((metrics: AgentSyncMetrics[]) => {
    setState(prev => {
      const syncMetrics: Record<string, AgentSyncMetrics> = {};
      for (const m of metrics) syncMetrics[m.agentId] = m;
      return { ...prev, syncMetrics };
    });
  }, []);

  return {
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
    updatePlanApprovalStatus,
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
    deleteEvent,
    upsertAgent,
    patchAgent,
    removeAgent,
    setFocus,
    setPeers,
    setOutboundDispatches,
    setObjects,
    setSyncMetrics,
  };
}
