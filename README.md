# Obotovs

Multi-LLM AI coding assistant for VS Code with background agents, hierarchical memory, peer coordination, and a full tool ecosystem.

## Features

### Multi-Provider LLM Support

Oboto VS supports local and cloud LLM providers with a dual-model triage architecture — fast local models handle simple queries while powerful remote models tackle complex tasks.

| Provider | Type | Default Model |
|----------|------|---------------|
| Anthropic | Cloud | claude-sonnet-4-20250514 |
| OpenAI | Cloud | — |
| Google Gemini | Cloud | — |
| Vertex AI (Gemini) | Cloud | — |
| Vertex AI (Anthropic) | Cloud | — |
| OpenRouter | Cloud | — |
| DeepSeek | Cloud | — |
| Ollama | Local | llama3:8b |
| LM Studio | Local | — |

### Agent System

- **Foreground agent** — Interactive chat in the VS Code sidebar
- **Background agents** — Spawn parallel agents with `agent/spawn` for concurrent tasks, each with independent tool trees, budget ceilings, and timeouts
- **Kuramoto sync monitor** — Oscillator-based cross-agent synchronization detection; visual indicators show when agents converge on similar work
- **Up to 50 concurrent agents** (default: 5)

### Tool Ecosystem

| Category | Tools |
|----------|-------|
| **File** | read, write, edit (with undo) |
| **Search** | glob pattern matching, ripgrep with regex |
| **Shell** | blocking execution, background processes, integrated terminal |
| **Git** | status, diff, log, commit, branch, stash |
| **Workspace** | diagnostics, info, VS Code command execution |
| **User** | questions, secret/API key requests |
| **Surfaces** | create/update/delete AI-authored HTML panels |
| **Routes** | Next.js-style API endpoints (GET/POST/PUT/DELETE/PATCH) |
| **Skills** | Markdown playbooks discovered from `.obotovs/skills/` |
| **Agents** | spawn, query, list, cancel background agents |
| **Memory** | add, recall, promote, list, forget across scopes |
| **Peers** | list, dispatch tasks, ask questions across VS Code windows |
| **UI Control** | mouse, keyboard, screenshots via nut.js (opt-in) |

### Hierarchical Memory

Three-tier durable memory powered by prime-resonance semantic encoding ([tinyaleph](https://github.com/aleph-ai/tinyaleph)):

- **Conversation** — Ephemeral, per-session; inherited by spawned agents
- **Project** — Per-workspace; persists across sessions
- **Global** — Cross-workspace; persists everywhere

Tool outputs are auto-captured at low strength. The LLM promotes noteworthy entries upward via `memory/promote`.

### Surfaces & Routes

- **Surfaces** — AI-authored HTML pages rendered in VS Code webview panels. Stored in `.obotovs/surfaces/`. Can use CDN libraries (React, Tailwind, etc.) and call local API routes.
- **Routes** — Local API endpoints following Next.js App Router conventions. Stored in `.obotovs/routes/`. Supports dynamic segments (`[id]`), hot-reloads on file change.

### Workspace Skills

Drop markdown files in `.obotovs/skills/` with optional YAML frontmatter (`name`, `description`, `when`). The agent discovers and applies them automatically.

### Peer Coordination

Multiple VS Code windows running Oboto VS on the same workspace discover each other via HTTP heartbeats. Agents can dispatch tasks to peers (with user approval) and ask questions across windows.

### Permission Modes

| Mode | Description |
|------|-------------|
| `readonly` | Read-only file access, no shell |
| `workspace-write` | Read/write within workspace |
| `full-access` | Unrestricted |
| `prompt` | Ask before each action (default) |

## Installation

### From VSIX

```bash
npm run build
npm run package
code --install-extension obotovs-0.1.1.vsix
```

### Development

```bash
npm install
cd webview-ui && npm install && cd ..
npm run dev
```

Press **F5** in VS Code to launch the Extension Development Host.

## Configuration

All settings are under `obotovs.*` in VS Code settings. Key options:

```jsonc
{
  // LLM providers
  "obotovs.localProvider": "ollama",
  "obotovs.localModel": "llama3:8b",
  "obotovs.remoteProvider": "anthropic",
  "obotovs.remoteModel": "claude-sonnet-4-20250514",

  // Agent limits
  "obotovs.maxConcurrentAgents": 5,
  "obotovs.defaultAgentBudgetUsd": 0.5,
  "obotovs.agentTimeoutMs": 300000,

  // Behavior
  "obotovs.permissionMode": "prompt",
  "obotovs.triageEnabled": true,
  "obotovs.maxIterations": 50,
  "obotovs.maxContextTokens": 128000,
  "obotovs.autoCompact": true,

  // Features
  "obotovs.surfacesAutoOpen": false,
  "obotovs.uiControlEnabled": false,
  "obotovs.peerDispatchEnabled": true,
  "obotovs.instructionFile": "CLAUDE.md"
}
```

API keys are read from environment variables or can be entered via the settings UI:

| Provider | Env Variable |
|----------|-------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GOOGLE_AI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

## Project Instructions

Place a `CLAUDE.md` file in your workspace root (or any parent directory) to provide project-specific context to the agent. The filename is configurable via `obotovs.instructionFile`.

## Architecture

```
src/
  agent/
    orchestrator.ts      # Central coordinator
    agent-manager.ts     # Foreground + background agent lifecycle
    agent-host.ts        # ObotoAgent wrapper; emits UI-neutral events
    webview-bridge.ts    # Per-agent event relay to React UI
    session-store.ts     # Session persistence (per-window)
    system-prompt.ts     # Dynamic prompt builder
    tool-tree.ts         # Swiss-Army-Tool tree registration
    memory/              # Hierarchical memory (encoding, fields, manager)
    sync/                # Kuramoto cross-agent sync monitor
  config/
    settings.ts          # VS Code settings → typed config
    provider-registry.ts # LLM provider metadata
  surfaces/              # AI-authored HTML panel manager
  routes/                # Local API endpoint manager
  skills/                # Workspace skill discovery
  peers/                 # Multi-window coordination (HTTP RPC)
  vscode-integration/
    sidebar-provider.ts  # WebviewView provider
  shared/
    message-types.ts     # Extension <-> webview protocol
    logger.ts            # Structured logging

webview-ui/src/
  App.tsx                # Main React app
  components/
    ChatPanel.tsx        # Conversation display
    InputArea.tsx        # User input with slash commands
    AgentStrip.tsx       # Background agent pills with sync dots
    PeersStrip.tsx       # Peer window indicators
    ObjectManagerView.tsx # Memory/surface/route object browser
  hooks/
    useMessages.ts       # React state management
    useVsCode.ts         # VS Code API bridge
```

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| Focus Chat | `Cmd+Shift+L` | Focus the Oboto VS sidebar |
| New Session | — | Start a fresh conversation |
| Switch Model | — | Change the active LLM |
| Ask About Selection | Context menu | Ask the agent about selected code |
| Open Settings | — | Open the settings panel |

## Testing

```bash
npm test
```

Runs vitest suites for the memory system and sync monitor.

## License

MIT — Sebastian Schepis
