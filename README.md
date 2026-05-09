<p align="center">
  <img src="assets/icon.png" alt="Oboto VS" width="120" height="120" />
</p>

<h1 align="center">Oboto VS</h1>

<p align="center">
  <strong>Build AI-powered applications on top of the Visual Studio Code platform.</strong><br/>
  Embed UIs, create API endpoints, and orchestrate complex multi-agent workflows<br/>
  with natural language commands and a powerful toolkit of pre-built actions.
</p>

<p align="center">
  <a href="https://github.com/sschepis/clodcode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <img src="https://img.shields.io/badge/vscode-≥1.85-blue?logo=visualstudiocode" alt="VS Code" />
  <img src="https://img.shields.io/badge/status-preview-orange" alt="Preview" />
  <img src="https://img.shields.io/badge/tools-100+-purple" alt="100+ Tools" />
</p>

---

Oboto VS turns your editor into an AI application platform. Spawn agents that read, write, and refactor code. Create interactive web UIs that live inside VS Code. Stand up local API endpoints in seconds. Coordinate work across multiple windows with a built-in peer network. All of it driven by conversation.

<br/>

## Quick Start

```
1. Install the extension
2. Open the sidebar (Oboto icon) or press Cmd+Shift+L
3. Configure at least one LLM provider in Settings
4. Start talking.
```

That's it. The agent has access to **100+ tools** out of the box — file I/O, git, code intelligence, web browsing, and more. No configuration files to write, no tool definitions to maintain.

<br/>

---

## Core Concepts

### Agents

Oboto runs a **foreground agent** that powers your chat, plus up to **50 background agents** that work in parallel. Agents can spawn sub-agents recursively (configurable depth), communicate with each other via messages, and coordinate across VS Code windows through a peer network.

Every agent has a **budget ceiling** (USD) and **timeout** so costs stay predictable.

```
You:  "Refactor the auth module, run the test suite, and update
       the changelog — all at the same time."

Oboto spawns 3 background agents, each tackling one task in parallel.
```

### Surfaces

**Surfaces** are interactive HTML panels that live inside VS Code. Build dashboards, forms, data visualizations — anything you can put in a browser. They support React, Vue, Svelte, or vanilla JS, auto-reload on save, and communicate with agents through a channel-based messaging system.

```
You:  "Create a surface that shows a live dashboard of my API response times."

Oboto writes the HTML, opens it as a webview panel, and wires up the data.
```

### Routes

**Routes** are local API endpoints. Oboto spins up an Express-compatible server, auto-assigns ports, and hot-reloads your route files on save. Perfect for prototyping backends, creating webhook receivers, or building tool integrations without leaving the editor.

```
You:  "Create a POST endpoint at /api/summarize that takes a body
       of text and returns a summary."

Oboto creates the route file, starts the server, and gives you the URL.
```

### Skills

**Skills** are markdown instruction files that extend what the agent knows how to do. Drop a `.md` file into `.obotovs/skills/` and its contents are automatically injected into the agent's system prompt. No code required — just write what you want the agent to know.

<br/>

---

## Features at a Glance

### Multi-LLM Routing

Connect any combination of providers and route tasks to the right model for the job.

| Provider | Type |
|----------|------|
| Anthropic (Claude) | Cloud |
| OpenAI (GPT-4) | Cloud |
| Google Gemini | Cloud |
| Azure OpenAI | Cloud |
| Vertex AI | Cloud |
| DeepSeek | Cloud |
| OpenRouter | Cloud |
| Ollama | Local |
| LM Studio | Local |
| VS Code LM API | Local |

**Role-based routing** assigns models per task type:

| Role | Purpose |
|------|---------|
| **Triage** | Fast, cheap model for quick classification |
| **Executor** | Powerful model for main task execution |
| **Coder** | Specialized for code generation |
| **Planner** | Architecture and planning |
| **Summarizer** | Context compaction |

Mix local and cloud models freely. Use a local model for triage and a cloud model for heavy lifting — the system handles fallbacks automatically.

<br/>

### 100+ Built-in Tools

<table>
<tr>
<td width="50%" valign="top">

**File & Git**
- Read, write, edit files with patch support
- Git status, diff, log, commit, branch, stash
- Automated code review

**Code Intelligence (30+ tools)**
- Go to definition, references, implementations
- Call hierarchy & type hierarchy
- Dataflow & impact analysis
- Semantic diff tracking
- Rename, format, quick fixes
- Tree-sitter code exploration
- Diagnostics & inline annotations

**Search**
- Glob pattern matching
- Full-text regex search with context
- Cross-file symbol search

**Shell**
- Sync & background command execution
- Run arbitrary JS/TS code

</td>
<td width="50%" valign="top">

**Web**
- Search (Brave / DuckDuckGo)
- Fetch & parse HTML/JSON
- Headless browser automation (Puppeteer)
- Form filling, screenshots, JS eval

**Agent Orchestration**
- Spawn, query, cancel agents
- Inter-agent messaging
- Batch spawn & collect results
- Budget & timeout enforcement

**Workspace & IDE**
- Execute any VS Code command
- Project structure analysis
- Persistent key-value data store

**UI Automation** *(macOS, opt-in)*
- Mouse & keyboard control
- Screen capture & cursor tracking

</td>
</tr>
</table>

<br/>

### Peer Network

Multiple VS Code windows discover each other automatically. Dispatch tasks to peer agents, ask for confirmations, and coordinate work across windows — all with user approval gates.

```
You:  "Ask the agent in my other window to run the integration tests
       while I keep working here."
```

### Hierarchical Memory

Three-tier durable memory system:

| Scope | Lifetime | Use |
|-------|----------|-----|
| **Conversation** | Per-session | Ephemeral context, inherited by sub-agents |
| **Project** | Per-workspace | Persists across sessions |
| **Global** | Cross-workspace | Available everywhere |

Automatic compaction when approaching token limits. Promote important facts to global scope with a single tool call.

### Project Management

Built-in framework for **plans**, **tasks**, and **reviews**. The agent can propose plans that require your approval before execution, track tasks with status updates, and create structured reviews. Active project conventions are injected into the system prompt automatically.

| Mode | Use case |
|------|----------|
| **New builds** | Scaffold, plan features, track tasks |
| **Existing codebases** | Auto-detect conventions and enforce them |
| **Ad-hoc** | Lightweight task tracking without upfront planning |

### Permission Control

| Mode | Description |
|------|-------------|
| `readonly` | Read-only file access, no shell |
| `workspace-write` | Read/write within workspace |
| `full-access` | Unrestricted access |
| `prompt` | Ask before each action *(default)* |

### Chaperone System

After a configurable number of iterations (default: 25), the agent pauses for a human review checkpoint. Combined with per-agent budget ceilings, this keeps autonomous work predictable without constant supervision.

<br/>

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+L` | Focus chat |
| `Cmd+Shift+N` | New chat window |
| `Cmd+Shift+O` | Quick task picker |
| `Escape` | Stop agent |

<br/>

---

## Configuration

All settings live under `obotovs.*` in VS Code settings.

```jsonc
{
  // Connect your LLM providers
  "obotovs.providers": [
    {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKey": "${env:ANTHROPIC_API_KEY}"
    },
    {
      "type": "ollama",
      "model": "llama3",
      "baseUrl": "http://localhost:11434"
    }
  ],

  // Route tasks to the right model
  "obotovs.routing": {
    "triage":   { "provider": "ollama",    "model": "llama3" },
    "executor": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
  },

  // Agent guardrails
  "obotovs.maxConcurrentAgents": 5,
  "obotovs.defaultAgentBudgetUsd": 0.50,
  "obotovs.agentTimeoutMs": 300000,
  "obotovs.maxAgentNestingDepth": 2,

  // Auto-compact when context grows large
  "obotovs.autoCompact": true,
  "obotovs.autoCompactThreshold": 150000
}
```

API keys can be set inline, via environment variables, or entered through the Settings UI:

| Provider | Env Variable |
|----------|-------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GOOGLE_AI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

<br/>

---

## Project Structure

```
.obotovs/
├── surfaces/       # Interactive HTML panels
├── routes/         # Local API endpoints
├── skills/         # Markdown instruction files
├── projects/       # Plans, tasks, and reviews
└── data/           # Key-value data store
```

The agent manages this directory automatically. You can also create and edit files here directly — changes are picked up via file watchers with hot reload.

Place a `CLAUDE.md` file in your workspace root to provide project-specific context to the agent. The filename is configurable via `obotovs.instructionFile`.

<br/>

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     VS Code Extension                   │
│                                                         │
│  ┌──────────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │ Orchestrator  │──│  Bridge   │──│  Webview Chat    │  │
│  └──────┬───────┘  └───────────┘  └─────────────────┘  │
│         │                                               │
│  ┌──────┴───────┐                                       │
│  │Agent Manager  │── Foreground Agent                   │
│  │              │── Background Agent 1                  │
│  │              │── Background Agent 2  ...             │
│  └──────┬───────┘                                       │
│         │                                               │
│  ┌──────┴───────┐  ┌───────────┐  ┌─────────────────┐  │
│  │  Tool Tree   │  │ Surfaces  │  │  Route Server   │  │
│  │  (100+)      │  │ Manager   │  │                 │  │
│  └──────────────┘  └───────────┘  └─────────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │ Peer Network │  │  Memory   │  │  Skill Manager  │  │
│  │              │  │  Store    │  │                 │  │
│  └──────────────┘  └───────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

The **Orchestrator** wires everything together. The **Agent Manager** enforces concurrency limits and lifecycles. The **Tool Tree** exposes all capabilities through a unified routing interface. **Surfaces**, **Routes**, and **Skills** are file-backed systems with hot reload. The **Peer Network** handles cross-window discovery and coordination.

<br/>

---

## What Can You Build?

- **Custom dashboards** — live metrics, data visualizations, admin panels
- **API prototypes** — webhook receivers, proxy endpoints, mock servers
- **Development tools** — linters, analyzers, migration scripts
- **Multi-agent workflows** — code review pipelines, test orchestration, deployment automation
- **Interactive tutorials** — step-by-step guides with embedded UIs
- **AI-enhanced coding** — custom skills that teach the agent your team's patterns

<br/>

---

## Development

```bash
# Install dependencies
npm install
cd webview-ui && npm install && cd ..

# Dev build with watch
npm run dev

# Production build
npm run build

# Package VSIX
npm run package

# Run tests
npm test
```

Press **F5** in VS Code to launch the Extension Development Host.

<br/>

---

## Requirements

- VS Code 1.85+
- At least one LLM provider configured (cloud or local)
- **Optional:** Chrome/Chromium for web browsing tools
- **Optional:** macOS Accessibility & Screen Recording permissions for UI automation

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/sschepis">Sebastian Schepis</a></sub>
</p>
