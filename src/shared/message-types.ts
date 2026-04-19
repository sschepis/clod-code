/**
 * Typed message protocol between the VS Code extension host and the webview.
 * All communication uses vscode.postMessage with these discriminated unions.
 */

// ── Event types flowing through the UI ────────────────────────────────

export type EventRole = 'user' | 'assistant' | 'thought' | 'tool' | 'system' | 'narrative' | 'permission' | 'question' | 'secret_request' | 'peer_dispatch_request';

export interface BaseEvent {
  id: string;
  role: EventRole;
  timestamp: string;
}

export interface UserEvent extends BaseEvent {
  role: 'user';
  content: string;
  attachments?: Attachment[];
}

export interface AssistantEvent extends BaseEvent {
  role: 'assistant';
  content: string;
  model?: string;
}

export interface ThoughtEvent extends BaseEvent {
  role: 'thought';
  content: string;
  duration?: string;
}

export interface ToolEvent extends BaseEvent {
  role: 'tool';
  toolName: string;
  command: string;
  status: 'running' | 'success' | 'error';
  output?: string;
  duration?: string;
  kwargs?: Record<string, unknown>;
}

export interface NarrativeEvent extends BaseEvent {
  role: 'narrative';
  content: string;
  iteration: number;
  totalToolCalls: number;
}

export interface SystemEvent extends BaseEvent {
  role: 'system';
  content: string;
}

export interface PermissionEvent extends BaseEvent {
  role: 'permission';
  toolName: string;
  toolInput: string;
  description: string;
  status: 'pending' | 'allowed' | 'denied';
}

export interface QuestionEvent extends BaseEvent {
  role: 'question';
  promptId: string;
  question: string;
  /** For choice-mode questions. Empty/undefined when `inputMode === 'text'`. */
  choices: string[];
  defaultChoice?: number;
  /** 'choice' (default) renders radio options; 'text' renders a text input. */
  inputMode?: 'choice' | 'text';
  status: 'pending' | 'answered' | 'cancelled';
  answerIndex?: number;
  answerText?: string;
}

export interface SecretRequestEvent extends BaseEvent {
  role: 'secret_request';
  promptId: string;
  name: string;
  description?: string;
  envPath: string;
  status: 'pending' | 'answered' | 'cancelled';
  savedToFile?: boolean;
}

export interface PeerDispatchRequestEvent extends BaseEvent {
  role: 'peer_dispatch_request';
  promptId: string;    // same as rpcId on the receiver
  fromWindowId: string;
  task: string;
  label: string;
  status: 'pending' | 'approved' | 'rejected';
}

export type SessionEvent =
  | UserEvent
  | AssistantEvent
  | ThoughtEvent
  | ToolEvent
  | NarrativeEvent
  | SystemEvent
  | PermissionEvent
  | QuestionEvent
  | SecretRequestEvent
  | PeerDispatchRequestEvent;

export interface Attachment {
  id: number;
  type: 'image' | 'text';
  name: string;
  url?: string;
  content?: string;
}

// ── Phase tracking ────────────────────────────────────────────────────

export type AgentPhase =
  | 'idle'
  | 'request'
  | 'precheck'
  | 'planning'
  | 'thinking'
  | 'tools'
  | 'validation'
  | 'memory'
  | 'continuation'
  | 'error'
  | 'doom'
  | 'cancel'
  | 'complete';

export interface PhaseState {
  phase: AgentPhase;
  message: string;
}

// ── Cost / usage tracking ─────────────────────────────────────────────

export interface CostState {
  totalTokens: number;
  totalCost: number;
  promptTokens?: number;
  completionTokens?: number;
}

// ── Agent identity ────────────────────────────────────────────────────

/** Reserved id for the default (foreground) agent. */
export const FOREGROUND_AGENT_ID = 'foreground';

export type AgentStatus = 'running' | 'idle' | 'complete' | 'error' | 'cancelled';

export interface AgentSummary {
  id: string;
  parentId?: string;
  label: string;            // short display label (task prefix or definition name)
  task?: string;            // full task prompt
  status: AgentStatus;
  model: ModelInfo;
  cost: CostState;
  createdAt: number;
  depth: number;            // nesting depth (0 = foreground, 1 = direct child, etc.)
  batchId?: string;         // shared ID for agents spawned by agent/batch
  completedAt?: number;
  result?: string;
  error?: string;
}

export interface AgentSyncMetrics {
  agentId: string;
  /** Max crossSync with any other running agent [0,1] */
  syncScore: number;
  /** Per-peer breakdown. Key is other agentId, value is crossSync [0,1] */
  pairScores: Record<string, number>;
}

/** Peer window summary shipped to the webview. Mirror of `PeerSnapshot` from
 *  `src/peers/peer-manager.ts` minus fields the UI doesn't need. */
export interface PeerUiSnapshot {
  windowId: string;
  pid: number;
  startedAt: number;
  lastSeen: number;
  agents: AgentSummary[];
}

// ── Object Manager snapshot shapes ────────────────────────────────────

export interface SurfaceInfo {
  name: string;
  filePath: string;
}

export interface RouteInfo {
  urlPath: string;
  filePath: string;
  segments: string[];
}

export interface SkillInfo {
  name: string;
  description?: string;
  filePath: string;
}

export type MemoryScope = 'global' | 'project' | 'conversation';

export interface MemoryInfo {
  id: string;
  title: string;
  scope: MemoryScope;
  /** For conversation-scope entries: the agent id that owns the entry. */
  agentId?: string;
  tags: string[];
  strength: number;
  createdAt: number;
}

export interface ConversationInfo {
  /** windowId for live windows, or the archive timestamp for history entries. */
  id: string;
  label: string;
  kind: 'current' | 'peer' | 'archive';
  filePath?: string;
  /** epoch millis of file mtime (best effort). */
  updatedAt?: number;
}

export interface ObjectSnapshot {
  surfaces: SurfaceInfo[];
  routes: RouteInfo[];
  skills: SkillInfo[];
  memories: MemoryInfo[];
  conversations: ConversationInfo[];
}

export type ObjectCategory =
  | 'surface'
  | 'route'
  | 'skill'
  | 'agent'
  | 'memory'
  | 'conversation';

export type ObjectActionKind = 'open' | 'delete' | 'reveal';

/** Outbound dispatch shipped to the webview. Mirror of `OutboundDispatch`
 *  from `src/peers/peer-manager.ts`. */
export interface OutboundDispatchUi {
  rpcId: string;
  peerWindowId: string;
  label: string;
  task: string;
  status: 'pending_approval' | 'running' | 'completed' | 'error' | 'rejected' | 'cancelled';
  sentAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  reason?: string;
}

// ── Model / provider info ─────────────────────────────────────────────

export interface ModelInfo {
  provider: string;
  providerDisplayName?: string;
  model: string;
  isLocal: boolean;
  /** True if the model name doesn't match the provider (e.g. Gemini model under Anthropic provider). */
  mismatch?: boolean;
  /** Human-friendly description of the mismatch, shown in tooltips. */
  mismatchReason?: string;
  /** True if the agent is currently initialized and ready to take input. */
  ready?: boolean;
}

export interface PickerProviderInfo {
  name: string;
  displayName: string;
  isLocal: boolean;
  configured: boolean;
  models: string[];
}

// ── Extension → Webview messages ──────────────────────────────────────

/**
 * `agentId` is optional on every per-agent message; if omitted, the webview
 * routes it to the foreground slice. Kept optional for back-compat with the
 * single-agent path.
 */
export type ExtToWebviewMessage =
  | { type: 'sync'; agentId?: string; events: SessionEvent[]; phase: PhaseState; cost: CostState; activeModel: ModelInfo; mode: 'act' | 'plan'; agents?: AgentSummary[]; focusedAgentId?: string }
  | { type: 'event'; agentId?: string; event: SessionEvent }
  | { type: 'token'; agentId?: string; text: string; eventId: string }
  | { type: 'phase'; agentId?: string; phase: AgentPhase; message: string }
  | { type: 'cost_update'; agentId?: string; cost: CostState }
  | { type: 'model_changed'; agentId?: string; model: ModelInfo }
  | { type: 'tool_status'; agentId?: string; eventId: string; status: 'running' | 'success' | 'error'; output?: string; duration?: string }
  | { type: 'permission_request'; agentId?: string; eventId: string; toolName: string; toolInput: string; description: string }
  | { type: 'permission_resolved'; agentId?: string; eventId: string; status: 'allowed' | 'denied' }
  | { type: 'ask_question'; agentId?: string; promptId: string; question: string; choices: string[]; defaultChoice?: number; inputMode?: 'choice' | 'text' }
  | { type: 'ask_question_resolved'; agentId?: string; promptId: string; status: 'answered' | 'cancelled'; answerIndex?: number; answerText?: string }
  | { type: 'ask_secret'; agentId?: string; promptId: string; name: string; description?: string; envPath: string }
  | { type: 'ask_secret_resolved'; agentId?: string; promptId: string; status: 'answered' | 'cancelled'; savedToFile?: boolean }
  | { type: 'peer_dispatch_request'; agentId?: string; promptId: string; fromWindowId: string; task: string; label: string }
  | { type: 'peer_dispatch_resolved'; agentId?: string; promptId: string; status: 'approved' | 'rejected' }
  | { type: 'title_changed'; agentId?: string; title: string }
  | { type: 'clear'; agentId?: string }
  | { type: 'slash_commands'; commands: SlashCommandInfo[] }
  | { type: 'clear_stale_errors'; agentId?: string }
  // ── Multi-agent messages ─────────────────────────────────────────────
  | { type: 'agent_spawned'; agent: AgentSummary }
  | { type: 'agent_status'; agentId: string; status: AgentStatus; cost?: CostState; result?: string; error?: string; completedAt?: number }
  | { type: 'agent_disposed'; agentId: string }
  | { type: 'agents_sync'; agents: AgentSummary[]; focusedAgentId: string }
  | { type: 'sync_update'; metrics: AgentSyncMetrics[] }
  // ── Peer windows (multi-window coordination) ─────────────────────────
  | { type: 'peers_update'; peers: PeerUiSnapshot[] }
  | { type: 'outbound_dispatches_update'; dispatches: OutboundDispatchUi[] }
  // ── Object Manager ───────────────────────────────────────────────────
  | { type: 'objects_sync'; snapshot: ObjectSnapshot }
  // ── Model picker ────────────────────────────────────────────────────
  | { type: 'provider_models'; providers: PickerProviderInfo[] }
  // ── Speech-to-text ──────────────────────────────────────────────────
  | { type: 'recording_status'; status: 'idle' | 'recording' | 'transcribing' | 'error'; message?: string }
  | { type: 'recording_transcript'; text: string }
  | { type: 'recording_error'; error: string };

// ── Webview → Extension messages ──────────────────────────────────────

export type WebviewToExtMessage =
  | { type: 'ready'; panelAgentId?: string }
  | { type: 'submit'; agentId?: string; text: string; attachments?: Attachment[]; mode: 'act' | 'plan' }
  | { type: 'interrupt'; agentId?: string }
  | { type: 'permission_response'; agentId?: string; eventId: string; allowed: boolean; remember: boolean }
  | { type: 'ask_question_response'; agentId?: string; promptId: string; cancelled?: boolean; answerIndex?: number; answerText?: string }
  | { type: 'ask_secret_response'; agentId?: string; promptId: string; cancelled?: boolean; value?: string; saveToFile?: boolean }
  | { type: 'peer_dispatch_response'; agentId?: string; promptId: string; approved: boolean }
  | { type: 'change_model'; agentId?: string; provider: string; model: string }
  | { type: 'clear_session'; agentId?: string }
  | { type: 'revert'; agentId?: string; eventId: string }
  | { type: 'delete_event'; agentId?: string; eventId: string }
  | { type: 'edit_and_resubmit'; agentId?: string; eventId: string; text: string }
  | { type: 'slash_command'; agentId?: string; command: string; args: string }
  | { type: 'focus_agent'; agentId: string }
  | { type: 'cancel_agent'; agentId: string }
  | { type: 'new_chat' }
  // ── Object Manager ───────────────────────────────────────────────────
  | { type: 'request_objects_sync' }
  // ── Model picker ────────────────────────────────────────────────────
  | { type: 'request_provider_models' }
  // ── Speech-to-text ──────────────────────────────────────────────────
  | { type: 'start_recording' }
  | { type: 'stop_recording' }
  | {
      type: 'object_action';
      category: ObjectCategory;
      action: ObjectActionKind;
      /** category-specific identifier (name for surface/skill, urlPath for route, id for agent/memory/conversation). */
      id: string;
      /** extra context for the memory category (agentId for conversation scope). */
      agentId?: string;
    };

// ── Slash command info ────────────────────────────────────────────────

export interface SlashCommandInfo {
  name: string;
  summary: string;
  argumentHint?: string;
  icon?: string;
}

// ── Settings panel protocol ───────────────────────────────────────────

export interface SettingsState {
  localProvider: string;
  localModel: string;
  localBaseUrl: string;
  localApiKey: string;
  remoteProvider: string;
  remoteModel: string;
  remoteApiKey: string;
  remoteBaseUrl: string;
  permissionMode: 'readonly' | 'workspace-write' | 'full-access' | 'prompt';
  maxIterations: number;
  maxContextTokens: number;
  triageEnabled: boolean;
  autoCompact: boolean;
  autoCompactThreshold: number;
  instructionFile: string;
  maxConcurrentAgents: number;
  defaultAgentBudgetUsd: number;
  agentTimeoutMs: number;
}

export interface ProviderOption {
  name: string;
  displayName: string;
  isLocal: boolean;
  requiresApiKey: boolean;
  envKeyVar: string;
  envKeySet: boolean;
  defaultBaseUrl?: string;
}

export type SettingsExtToWebview =
  | { type: 'sync'; settings: SettingsState; providers: ProviderOption[] }
  | { type: 'save_result'; success: boolean; message: string; saved: Partial<SettingsState> }
  | { type: 'connection_test'; target: 'local' | 'remote'; success: boolean; message: string };

export type SettingsWebviewToExt =
  | { type: 'ready' }
  | { type: 'save'; settings: Partial<SettingsState> }
  | { type: 'test_connection'; target: 'local' | 'remote'; overrides?: Partial<SettingsState> }
  | { type: 'reset_to_defaults' }
  | { type: 'open_logs' };

