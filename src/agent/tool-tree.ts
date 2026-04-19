import { TreeBuilder, SessionManager, Router, BranchNode, LeafNode } from '@sschepis/swiss-army-tool';
import {
  createFileReadHandler, createFileWriteHandler, createFileEditHandler,
  createShellRunHandler, createShellBackgroundHandler,
  createGlobSearchHandler, createGrepSearchHandler,
  createGitStatusHandler, createGitDiffHandler, createGitLogHandler,
  createGitCommitHandler, createGitBranchHandler, createGitStashHandler,
  createDiagnosticsHandler,
  createWorkspaceInfoHandler, createOpenFilesHandler,
  createTerminalHandler,
  createAskHandler, createSecretHandler,
  createAgentSpawnHandler, createAgentQueryHandler, createAgentMessageHandler,
  createAgentListHandler, createAgentCancelHandler,
  createAgentBatchHandler, createAgentCollectHandler,
  createSurfaceListHandler, createSurfaceCreateHandler, createSurfaceUpdateHandler,
  createSurfaceDeleteHandler, createSurfaceOpenHandler,
  createRouteListHandler, createRouteInfoHandler, createRouteCreateHandler,
  createRouteUpdateHandler, createRouteDeleteHandler,
  createVscodeRunHandler, createVscodeListHandler,
  createUiScreenshotHandler, createUiCursorHandler,
  createUiMoveHandler, createUiClickHandler, createUiDragHandler,
  createUiTypeHandler, createUiPressHandler,
  createSkillListHandler, createSkillGetHandler,
  createPeerListHandler, createPeerDebugHandler, createPeerSendHandler,
  createPeerDispatchHandler, createPeerStatusHandler,
  createPeerAskHandler, createPeerAskStatusHandler, createPeerCancelHandler,
  createRefactorPipelineHandler, createRefactorRegexHandler,
  createMemoryAddHandler, createMemoryRecallHandler, createMemoryPromoteHandler,
  createMemoryListHandler, createMemoryForgetHandler,
  type AskDeps, type SecretDeps, type AgentToolDeps,
  type SurfaceToolDeps, type RouteToolDeps, type SkillToolDeps,
  type PeerToolDeps, type MemoryToolDeps, type ShellDeps,
  createChatSetTitleHandler, type ChatTitleDeps,
  createSpeakHandler, type ElevenLabsTtsDeps,
} from '../tools';

export interface ToolTreeResult {
  router: Router;
  session: SessionManager;
}

export interface ToolTreeDeps {
  ask: AskDeps;
  secret: SecretDeps;
  /** Optional — when omitted (e.g. for background agents), agent/* branch is skipped. */
  agent?: AgentToolDeps;
  /** Workspace-scoped surface manager (shared by foreground + background). */
  surface: SurfaceToolDeps;
  /** Workspace-scoped routes manager (shared by foreground + background). */
  route: RouteToolDeps;
  /** Workspace-scoped skill manager (shared by foreground + background). */
  skill: SkillToolDeps;
  /** Workspace-scoped peer manager — lets the AI see other Oboto VS windows. */
  peer: PeerToolDeps;
  /** Hierarchical memory (conversation/project/global). Optional for tests. */
  memory?: MemoryToolDeps;
  /** Chat title control — lets the agent rename its conversation window. */
  chatTitle?: ChatTitleDeps;
  /** Shell configuration — which shell binary to use for commands. */
  shell: ShellDeps;
  /** ElevenLabs TTS — lets the agent speak aloud to the user. */
  tts?: ElevenLabsTtsDeps;
}

/**
 * Build the swiss-army-tool command tree with all coding tools.
 * Returns the Router (for ObotoAgent) and SessionManager (for persistence).
 */
export function buildToolTree(deps: ToolTreeDeps): ToolTreeResult {
  const session = new SessionManager();

  const builder = TreeBuilder.create('root', 'Oboto VS coding assistant tool tree')
    // ── File operations ────────────────────────────────────────────
    .branch('file', 'File operations — read, write, edit, list', (file) => {
      file
        .leaf('read', {
          description: 'Read a file with line numbers. Supports offset and limit for large files.',
          requiredArgs: { path: { type: 'string', description: 'Absolute or workspace-relative file path' } },
          optionalArgs: {
            offset: { type: 'number', description: 'Start line (0-based)', default: 0 },
            limit: { type: 'number', description: 'Number of lines to read', default: 2000 },
          },
          handler: createFileReadHandler(),
        })
        .leaf('write', {
          description: 'Create or overwrite a file. Creates parent directories automatically.',
          requiredArgs: {
            path: { type: 'string', description: 'File path' },
            content: { type: 'string', description: 'File content' },
          },
          handler: createFileWriteHandler(),
        })
        .leaf('edit', {
          description: [
            'Edit a file by replacing exact string matches. Supports undo when the file is open.',
            'Three modes: (1) Single edit with old_string/new_string.',
            '(2) Multi-edit with edits[] array — applies all atomically.',
            '(3) Line-anchored insert with after_line or before_line + new_string — inserts without needing to match existing text.',
            'If exact match fails, suggests similar lines with whitespace differences.',
          ].join(' '),
          requiredArgs: {
            path: { type: 'string', description: 'File path' },
          },
          optionalArgs: {
            old_string: { type: 'string', description: 'Exact string to find and replace (mode 1)' },
            new_string: { type: 'string', description: 'Replacement string (modes 1 & 3)' },
            replace_all: { type: 'boolean', description: 'Replace all occurrences of old_string', default: false },
            edits: { type: 'json', description: 'Array of {old_string, new_string} pairs for batch editing (mode 2). All validated before any are applied.' },
            after_line: { type: 'number', description: 'Insert new_string after this line number (1-based). Use 0 to insert at file start. (mode 3)' },
            before_line: { type: 'number', description: 'Insert new_string before this line number (1-based). (mode 3)' },
          },
          handler: createFileEditHandler(),
        });
    })

    // ── Search operations ──────────────────────────────────────────
    .branch('search', 'Search for files and code content', (search) => {
      search
        .leaf('glob', {
          description: 'Find files by glob pattern (e.g., "**/*.ts", "src/**/*.test.*")',
          requiredArgs: { pattern: { type: 'string', description: 'Glob pattern' } },
          optionalArgs: {
            exclude: { type: 'string', description: 'Exclude pattern', default: '**/node_modules/**' },
            max_results: { type: 'number', description: 'Max files to return', default: 100 },
          },
          handler: createGlobSearchHandler(),
        })
        .leaf('grep', {
          description: 'Search file contents by regex pattern using ripgrep.',
          requiredArgs: { pattern: { type: 'string', description: 'Regex pattern to search for' } },
          optionalArgs: {
            path: { type: 'string', description: 'Directory or file to search in' },
            type: { type: 'string', description: 'File type filter (e.g., ts, py, rust)' },
            glob: { type: 'string', description: 'Glob filter (e.g., "*.tsx")' },
            context: { type: 'number', description: 'Context lines around match' },
            case_insensitive: { type: 'boolean', description: 'Case insensitive search' },
            max_results: { type: 'number', description: 'Max matches', default: 50 },
          },
          handler: createGrepSearchHandler(),
        });
    })

    // ── Shell execution ───────────────────────────────────────────
    .branch('shell', 'Execute shell commands', (shell) => {
      shell
        .leaf('run', {
          description: 'Execute a shell command and return stdout/stderr. Use for builds, tests, etc.',
          requiredArgs: { cmd: { type: 'string', description: 'Shell command to execute' } },
          optionalArgs: {
            cwd: { type: 'string', description: 'Working directory' },
            timeout: { type: 'number', description: 'Timeout in ms', default: 30000 },
          },
          handler: createShellRunHandler(deps.shell),
        })
        .leaf('background', {
          description: 'Run a command in the background (detached). Returns immediately.',
          requiredArgs: { cmd: { type: 'string', description: 'Shell command to run' } },
          optionalArgs: { cwd: { type: 'string', description: 'Working directory' } },
          handler: createShellBackgroundHandler(deps.shell),
        })
        .leaf('terminal', {
          description: 'Send a command to the VS Code integrated terminal.',
          optionalArgs: {
            cmd: { type: 'string', description: 'Command to send (empty = just focus terminal)' },
            name: { type: 'string', description: 'Terminal name', default: 'Obotovs' },
          },
          handler: createTerminalHandler(),
        });
    })

    // ── Git operations ────────────────────────────────────────────
    .branch('git', 'Git version control operations', (git) => {
      git
        .leaf('status', {
          description: 'Show git status (branch, staged/unstaged changes)',
          handler: createGitStatusHandler(),
        })
        .leaf('diff', {
          description: 'Show git diff (unstaged changes, or staged with staged=true)',
          optionalArgs: {
            staged: { type: 'boolean', description: 'Show staged changes' },
            file: { type: 'string', description: 'Diff a specific file' },
          },
          handler: createGitDiffHandler(),
        })
        .leaf('log', {
          description: 'Show recent git commits',
          optionalArgs: {
            count: { type: 'number', description: 'Number of commits', default: 10 },
            verbose: { type: 'boolean', description: 'Show full commit messages' },
          },
          handler: createGitLogHandler(),
        })
        .leaf('commit', {
          description: 'Create a git commit. Stage specific files or use all=true.',
          requiredArgs: { message: { type: 'string', description: 'Commit message' } },
          optionalArgs: {
            files: { type: 'json', description: 'Array of files to stage' },
            all: { type: 'boolean', description: 'Stage all changes (git add -A)' },
          },
          handler: createGitCommitHandler(),
        })
        .leaf('branch', {
          description: 'List branches or create a new one.',
          optionalArgs: {
            name: { type: 'string', description: 'Branch name to create' },
            checkout: { type: 'boolean', description: 'Checkout the new branch' },
          },
          handler: createGitBranchHandler(),
        })
        .leaf('stash', {
          description: 'Git stash operations (push, pop, list, drop)',
          optionalArgs: {
            action: { type: 'string', description: 'Action: push, pop, list, drop', default: 'list' },
          },
          handler: createGitStashHandler(),
        });
    })

    // ── User interaction (ask, secrets) ────────────────────────────
    .branch('user', 'Ask the user questions or request secrets', (u) => {
      u
        .leaf('ask', {
          description: 'Ask the user a multiple-choice question at a decision point. Returns the choice the user selected. Use this when you need the user to pick a direction or confirm a non-obvious choice.',
          requiredArgs: {
            question: { type: 'string', description: 'The question to show the user' },
            choices: { type: 'json', description: 'Array of choice strings (at least 2)' },
          },
          optionalArgs: {
            default: { type: 'number', description: 'Default choice index (0-based)' },
          },
          handler: createAskHandler(deps.ask),
        })
        .leaf('secret', {
          description: 'Ask the user for a secret value (API key, token, password). By default the value is persisted to the workspace .env file and set on process.env for this session.',
          requiredArgs: {
            name: { type: 'string', description: 'Environment variable name, e.g. OPENAI_API_KEY' },
          },
          optionalArgs: {
            description: { type: 'string', description: 'Short explanation of why the secret is needed' },
            env_path: { type: 'string', description: 'Custom .env path (absolute or workspace-relative). Defaults to <workspace>/.env' },
          },
          handler: createSecretHandler(deps.secret),
        });
    })

    // ── Chat window control ─────────────────────────────────────────
    .branch('chat', 'Control the chat window — rename conversations, etc.', (chat) => {
      chat
        .leaf('set_title', {
          description: 'Set the title/name of this chat conversation window. Use this to give the conversation a meaningful name based on what is being discussed or worked on.',
          requiredArgs: {
            title: { type: 'string', description: 'The new title for the chat window (max 100 chars)' },
          },
          handler: createChatSetTitleHandler(deps.chatTitle ?? { setTitle: () => {} }),
        });
    })

    // ── Text-to-speech (ElevenLabs) ──────────────────────────────────
    .branch('tts', 'Text-to-speech — speak aloud to the user via ElevenLabs', (t) => {
      if (deps.tts) {
        t.leaf('speak', {
          description: 'Speak text aloud to the user using ElevenLabs text-to-speech. Only use when the user has asked you to speak or read something aloud. Requires ELEVENLABS_API_KEY in the environment.',
          requiredArgs: {
            text: { type: 'string', description: 'The text to speak aloud' },
          },
          optionalArgs: {
            voice_id: { type: 'string', description: 'ElevenLabs voice ID (default: George)' },
            model: { type: 'string', description: 'ElevenLabs model (default: eleven_multilingual_v2)' },
          },
          handler: createSpeakHandler(deps.tts),
        });
      }
    })

    // ── Skills (workspace-authored markdown skill files) ───────────
    .branch('skill', 'List and load workspace skills from .obotovs/skills/*.md', (s) => {
      s
        .leaf('list', {
          description: 'List all skills available in this workspace. Each skill has a name, a short description, and optionally a hint about when it applies. Use this to discover what domain-specific instructions the user has authored.',
          handler: createSkillListHandler(deps.skill),
        })
        .leaf('get', {
          description: 'Load the full instructions of a skill by name. After loading, follow the instructions verbatim for the remainder of the current turn. Use `skill list` first to discover available skills.',
          requiredArgs: {
            name: { type: 'string', description: 'The skill name (as shown by `skill list`)' },
          },
          handler: createSkillGetHandler(deps.skill),
        });
    })

    // ── Surfaces (AI-authored HTML pages rendered in VS Code panels) ──
    .branch('surface', [
      'Create, update, delete, list, and open surface HTML pages.',
      '',
      'Surfaces are self-contained HTML files stored at .obotovs/surfaces/<name>.html and rendered in VS Code webview panels.',
      'They are ideal for dashboards, visualizations, forms, documentation viewers, or any interactive UI the user needs.',
      '',
      'HOW TO WRITE A SURFACE:',
      '- Provide a complete HTML document including <!DOCTYPE html>, <html>, <head>, and <body>.',
      '- Use inline <style> and <script> tags — external file references are not supported.',
      '- CDN scripts and stylesheets ARE allowed. Common choices:',
      '  • Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>',
      '  • React + ReactDOM (UMD): <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>',
      '  • Chart.js, D3, Mermaid, Marked, etc. via unpkg/cdnjs/jsdelivr.',
      '- To call local API routes from a surface, use the global `window.__OBOTOVS_ROUTES_URL__`.',
      '  This is injected automatically and points to the local route server (e.g. http://localhost:PORT).',
      '  Example: fetch(`${window.__OBOTOVS_ROUTES_URL__}/api/data`).then(r => r.json())',
      '',
      'AUTO-REFRESH BEHAVIOR:',
      '- When you call surface/create, the panel opens automatically (if surfacesAutoOpen is enabled).',
      '- When you call surface/update, any open panel showing that surface is refreshed in-place immediately.',
      '- A file watcher also detects manual edits to surface files and refreshes open panels.',
      '- No need to call surface/open after surface/update — the refresh is automatic.',
    ].join('\n'), (s) => {
      s
        .leaf('list', {
          description: 'List all surfaces in .obotovs/surfaces/. Returns name + file path for each.',
          handler: createSurfaceListHandler(deps.surface),
        })
        .leaf('create', {
          description: [
            'Create a new surface HTML page at .obotovs/surfaces/<name>.html and open it in a webview panel.',
            'Provide a complete HTML document. CDN scripts (React, Tailwind, Chart.js, etc.) are allowed.',
            'Use window.__OBOTOVS_ROUTES_URL__ to fetch data from local routes.',
            'The panel opens automatically after creation.',
          ].join(' '),
          requiredArgs: {
            name: { type: 'string', description: 'Surface name — alphanumeric, hyphens, underscores only ([A-Za-z0-9_-]+)' },
            html: { type: 'string', description: 'Full HTML document content (<!DOCTYPE html>...). Use inline styles and scripts. CDN imports are allowed.' },
          },
          handler: createSurfaceCreateHandler(deps.surface),
        })
        .leaf('update', {
          description: [
            'Overwrite an existing surface with new HTML.',
            'Any open webview panel showing this surface is refreshed immediately — no need to call surface/open.',
            'Use this for iterative development: update the HTML, the user sees the result instantly.',
          ].join(' '),
          requiredArgs: {
            name: { type: 'string', description: 'Surface name (must already exist)' },
            html: { type: 'string', description: 'Full replacement HTML document content' },
          },
          handler: createSurfaceUpdateHandler(deps.surface),
        })
        .leaf('delete', {
          description: 'Delete a surface file and close its panel if open. The file is permanently removed.',
          requiredArgs: { name: { type: 'string', description: 'Surface name to delete' } },
          handler: createSurfaceDeleteHandler(deps.surface),
        })
        .leaf('open', {
          description: 'Open (or re-focus) a surface in a VS Code webview panel. Surfaces auto-open on creation, so this is mainly for re-opening a previously closed panel.',
          requiredArgs: { name: { type: 'string', description: 'Surface name to open' } },
          handler: createSurfaceOpenHandler(deps.surface),
        });
    })

    // ── Routes (Next.js App Router-style API endpoints) ────────────
    .branch('route', [
      'Create, update, delete, list API routes served from .obotovs/routes/.',
      '',
      'Routes are ES-module files at .obotovs/routes/<path>/route.js following the Next.js App Router convention.',
      'A local HTTP server starts automatically when the first route is created and serves all routes.',
      'Surfaces can call routes via window.__OBOTOVS_ROUTES_URL__ (injected into every surface).',
      '',
      'ROUTE FILE FORMAT:',
      '- Export named functions for each HTTP method: GET, POST, PUT, DELETE, PATCH.',
      '- Handler signature: async function METHOD(request, context) → Response | object',
      '  • request: { method, url, headers, body (parsed JSON or text), query (URLSearchParams object) }',
      '  • context: { params } — an object of dynamic segment values (e.g. { id: "42" })',
      '  • Return a Response object, or return a plain object/string (auto-wrapped as JSON 200).',
      '  • To set status/headers: return new Response(JSON.stringify(data), { status: 201, headers: { ... } })',
      '',
      'DYNAMIC SEGMENTS:',
      '- Use [brackets] in the path for dynamic parameters: "users/[id]" → params.id',
      '- Nested dynamics work: "projects/[projectId]/tasks/[taskId]"',
      '',
      'EXAMPLE:',
      '  // Route path: "items"',
      '  const items = [];',
      '  export async function GET() { return items; }',
      '  export async function POST(req) {',
      '    items.push(req.body);',
      '    return new Response(JSON.stringify(req.body), { status: 201 });',
      '  }',
      '',
      'HOT-RELOAD:',
      '- When you call route/create or route/update, the server rescans and reloads the route immediately.',
      '- Updated code takes effect on the next request — no server restart needed.',
      '- A file watcher also detects manual edits and triggers rescan.',
    ].join('\n'), (r) => {
      r
        .leaf('list', {
          description: 'List all registered routes with their URL path and file path. Use route/info for server status.',
          handler: createRouteListHandler(deps.route),
        })
        .leaf('info', {
          description: 'Show the route server status: whether it is running, its baseUrl (e.g. http://localhost:PORT), port number, and all registered route paths. Call this to get the base URL for testing routes with shell/run (curl).',
          handler: createRouteInfoHandler(deps.route),
        })
        .leaf('create', {
          description: [
            'Create a route file at .obotovs/routes/<path>/route.js.',
            'Export named handler functions: GET, POST, PUT, DELETE, PATCH.',
            'Handler signature: async (request, { params }) => Response | object.',
            'Dynamic segments use [brackets]: "users/[id]" makes params.id available.',
            'The server starts automatically and the route is live immediately.',
          ].join(' '),
          requiredArgs: {
            path: { type: 'string', description: 'Route path, e.g. "hello", "api/data", or "users/[id]". No leading slash.' },
            code: { type: 'string', description: 'Full ES-module source for route.js. Export named method handlers (GET, POST, etc.).' },
          },
          handler: createRouteCreateHandler(deps.route),
        })
        .leaf('update', {
          description: [
            'Overwrite an existing route file with new code.',
            'The updated handler takes effect on the next request — no server restart needed.',
            'The route server automatically rescans and reloads the module.',
          ].join(' '),
          requiredArgs: {
            path: { type: 'string', description: 'Route path (must already exist)' },
            code: { type: 'string', description: 'Full replacement ES-module source' },
          },
          handler: createRouteUpdateHandler(deps.route),
        })
        .leaf('delete', {
          description: 'Delete a route file and prune empty parent directories. The route is immediately unregistered from the server.',
          requiredArgs: { path: { type: 'string', description: 'Route path to delete' } },
          handler: createRouteDeleteHandler(deps.route),
        });
    })

    // ── Refactor (aegis-pipe: structured code transformations) ─────
    .branch('refactor', [
      'Structured code transformation pipeline powered by aegis-pipe.',
      'Use refactor/* for multi-step, validated, transactional edits that go beyond simple string replacement.',
      '',
      'Prefer file/edit for simple, targeted changes. Use refactor/* when you need:',
      '- Regex-based find-and-replace across a file',
      '- Multi-step transformation pipelines with atomic rollback',
      '- Dry-run previews of complex changes before applying',
      '',
      'All operations support dry_run mode (default) which shows a unified diff without modifying the file.',
      'Set execution_mode="apply" to write changes. Applied changes support undo when the file is open.',
    ].join('\n'), (r) => {
      r
        .leaf('pipeline', {
          description: [
            'Run a multi-step transformation pipeline against a file.',
            'Steps execute in order; if any step fails, all changes are rolled back.',
            'Supported step types: regex_replace (find/replace via regex pattern).',
            'Default mode is dry_run — shows the diff without modifying the file.',
          ].join(' '),
          requiredArgs: {
            target_file: { type: 'string', description: 'File path (absolute or workspace-relative)' },
            pipeline: { type: 'json', description: 'Array of step objects. Each has {step: "regex_replace", config: {pattern, replacement}}.' },
          },
          optionalArgs: {
            execution_mode: { type: 'string', description: '"dry_run" (default) or "apply"' },
          },
          handler: createRefactorPipelineHandler(),
        })
        .leaf('regex', {
          description: [
            'Quick regex find-and-replace in a file.',
            'Convenience shortcut for a single regex_replace pipeline step.',
            'Pattern uses JavaScript regex syntax. Matches are global (all occurrences).',
            'Default mode is dry_run — shows what would change without modifying the file.',
          ].join(' '),
          requiredArgs: {
            target_file: { type: 'string', description: 'File path' },
            pattern: { type: 'string', description: 'JavaScript regex pattern (e.g. "oldName\\\\b")' },
            replacement: { type: 'string', description: 'Replacement string (supports $1, $2 capture groups)' },
          },
          optionalArgs: {
            execution_mode: { type: 'string', description: '"dry_run" (default) or "apply"' },
          },
          handler: createRefactorRegexHandler(),
        });
    })

    // ── UI control (nut.js: screen + mouse + keyboard) ────────────
    .branch('ui', 'Capture the screen and drive mouse/keyboard via nut.js. Disabled by default — user must enable "Oboto VS: UI Control Enabled" in Settings.', (u) => {
      u
        .leaf('screenshot', {
          description: 'Capture the screen (or a region) and save a PNG to .obotovs/screenshots/. Returns the absolute path and a markdown image embed so the user can see the result inline.',
          optionalArgs: {
            name: { type: 'string', description: 'Filename (without extension). Default: timestamped.' },
            x: { type: 'number', description: 'Region top-left X (optional; all four required for region capture).' },
            y: { type: 'number', description: 'Region top-left Y' },
            width: { type: 'number', description: 'Region width' },
            height: { type: 'number', description: 'Region height' },
          },
          handler: createUiScreenshotHandler(),
        })
        .leaf('cursor', {
          description: 'Get current mouse cursor (x, y) in screen coordinates.',
          handler: createUiCursorHandler(),
        })
        .leaf('move', {
          description: 'Move the mouse to (x, y) in screen coordinates.',
          requiredArgs: {
            x: { type: 'number', description: 'Screen X' },
            y: { type: 'number', description: 'Screen Y' },
          },
          handler: createUiMoveHandler(),
        })
        .leaf('click', {
          description: 'Click the mouse. Optionally moves to (x, y) first. Supports left/middle/right and single/double click.',
          optionalArgs: {
            x: { type: 'number', description: 'Screen X (optional — clicks at current position if omitted)' },
            y: { type: 'number', description: 'Screen Y' },
            button: { type: 'string', description: '"left" (default), "right", or "middle"' },
            double: { type: 'boolean', description: 'True for double-click' },
          },
          handler: createUiClickHandler(),
        })
        .leaf('drag', {
          description: 'Press the left mouse button at (from_x, from_y) and drag to (to_x, to_y).',
          requiredArgs: {
            from_x: { type: 'number', description: 'Start X' },
            from_y: { type: 'number', description: 'Start Y' },
            to_x: { type: 'number', description: 'End X' },
            to_y: { type: 'number', description: 'End Y' },
          },
          handler: createUiDragHandler(),
        })
        .leaf('type', {
          description: 'Type a string of characters via the keyboard.',
          requiredArgs: {
            text: { type: 'string', description: 'Text to type' },
          },
          handler: createUiTypeHandler(),
        })
        .leaf('press', {
          description: 'Press a key combination. Accepts either an array like ["Cmd","S"] or a string like "Cmd+S". Supports Cmd/Ctrl/Alt/Shift modifiers and single letters, Enter/Escape/Tab/arrows, etc.',
          requiredArgs: {
            keys: { type: 'json', description: 'Array of key names or a "+"-joined string' },
          },
          handler: createUiPressHandler(),
        });
    })

    // ── VS Code commands ──────────────────────────────────────────
    .branch('peer', 'Coordinate with other Oboto VS windows on this workspace', (p) => {
      p
        .leaf('list', {
          description: 'List peer Oboto VS windows (other VS Code windows running Oboto VS on this workspace) and the agents running in each. Includes diagnostic info when no peers are found. Read-only — safe to call any time.',
          handler: createPeerListHandler(deps.peer),
        })
        .leaf('debug', {
          description: 'Dump comprehensive peer discovery diagnostic state: presence files, active windows, SSE connections, server port, and filtering details. Use this to diagnose why peers are not visible.',
          handler: createPeerDebugHandler(deps.peer),
        })
        .leaf('send', {
          description: 'Send a message to another agent in this window. By default waits synchronously for the target agent\'s response and returns it. Use peer/list first to see available agents. The message appears in the target agent\'s conversation with your name.',
          requiredArgs: {
            target_agent_id: { type: 'string', description: 'The target agent id (e.g. "foreground", "chat-abc123-1"). Prefix matching supported.' },
            message: { type: 'string', description: 'The message to send' },
          },
          optionalArgs: {
            async: { type: 'boolean', description: 'If true, send the message without waiting for a response (default: false — waits for response)' },
          },
          handler: createPeerSendHandler(deps.peer),
        })
        .leaf('dispatch', {
          description: 'Send a task to a peer window. The peer\'s user must approve before an agent spawns there. Returns an rpc_id you can poll with peer/status. Use peer/list first to see available peers and get their id.',
          requiredArgs: {
            peer_id: { type: 'string', description: 'Peer window id (prefix >= 4 chars is fine, e.g. "3b9f1c2a")' },
            task: { type: 'string', description: 'Task prompt for the peer\'s agent to execute' },
          },
          optionalArgs: {
            label: { type: 'string', description: 'Short label for the peer\'s agent strip (default: first 60 chars of task)' },
          },
          handler: createPeerDispatchHandler(deps.peer),
        })
        .leaf('status', {
          description: 'Poll a previously-dispatched task. Returns status (pending_approval / running / completed / error / rejected / cancelled), and result or error when terminal.',
          requiredArgs: {
            peer_id: { type: 'string', description: 'Peer window id from peer/dispatch' },
            rpc_id: { type: 'string', description: 'rpc_id returned from peer/dispatch' },
          },
          handler: createPeerStatusHandler(deps.peer),
        })
        .leaf('ask', {
          description: 'Ask a multiple-choice question of a peer window\'s user. Blocks up to 90s waiting for their answer; after that it returns the rpc_id so you can keep polling via peer/ask-status. Use this when you need input the user currently at another Oboto VS window can provide better than your user.',
          requiredArgs: {
            peer_id: { type: 'string', description: 'Target peer window id (prefix >= 4 chars)' },
            question: { type: 'string', description: 'The question to show the peer user' },
            choices: { type: 'json', description: 'Array of choice strings (at least 2)' },
          },
          optionalArgs: {
            default: { type: 'number', description: 'Default choice index (0-based)' },
          },
          handler: createPeerAskHandler(deps.peer),
        })
        .leaf('ask-status', {
          description: 'Poll a previously-asked peer question (pending / answered / cancelled / rejected).',
          requiredArgs: {
            peer_id: { type: 'string', description: 'Peer window id' },
            rpc_id: { type: 'string', description: 'rpc_id returned from peer/ask' },
          },
          handler: createPeerAskStatusHandler(deps.peer),
        })
        .leaf('cancel', {
          description: 'Cancel a dispatch you sent to a peer. Only the originating window can cancel.',
          requiredArgs: {
            peer_id: { type: 'string', description: 'Peer window id' },
            rpc_id: { type: 'string', description: 'rpc_id returned from peer/dispatch' },
          },
          handler: createPeerCancelHandler(deps.peer),
        });
    })

    .branch('vscode', 'Execute or discover VS Code commands', (v) => {
      v
        .leaf('list', {
          description: 'List available VS Code command IDs. Use this to discover commands before calling "vscode run". Supports substring filtering.',
          optionalArgs: {
            filter: { type: 'string', description: 'Case-insensitive substring to match command IDs (e.g. "editor.action")' },
            include_internal: { type: 'boolean', description: 'Include internal commands (prefixed with _); default false' },
            limit: { type: 'number', description: 'Max results to return; default 200' },
          },
          handler: createVscodeListHandler(),
        })
        .leaf('run', {
          description: 'Execute a VS Code command by id and return its result. Powerful and potentially destructive — can open files, run tasks, close windows, alter settings, etc. Prefer workspace/diagnostics or file/edit for simple edits; reach for this when no dedicated tool covers the need.',
          requiredArgs: {
            command: { type: 'string', description: 'Command id, e.g. "editor.action.formatDocument" or "workbench.action.tasks.runTask"' },
          },
          optionalArgs: {
            args: { type: 'json', description: 'Arguments passed to the command (array). Some commands take a single object or URI.' },
          },
          handler: createVscodeRunHandler(),
        });
    })

    // ── Workspace ─────────────────────────────────────────────────
    .branch('workspace', 'VS Code workspace information', (ws) => {
      ws
        .leaf('diagnostics', {
          description: 'Show TypeScript/lint errors and warnings from the workspace.',
          optionalArgs: {
            severity: { type: 'string', description: 'Filter by severity: error or warning' },
            file: { type: 'string', description: 'Filter to a specific file' },
          },
          handler: createDiagnosticsHandler(),
        })
        .leaf('info', {
          description: 'Show workspace folders, root path, and open files.',
          handler: createWorkspaceInfoHandler(),
        })
        .leaf('open-files', {
          description: 'List currently open editor tabs.',
          handler: createOpenFilesHandler(),
        });
    });

  // ── Background agents (foreground-only) ────────────────────────────
  // The agent branch is wired only when AgentToolDeps is provided. Phase 1
  // scope: only the foreground agent receives this branch so spawned
  // agents cannot recursively spawn further agents.
  if (deps.agent) {
    const agentDeps = deps.agent;
    builder.branch('agent', 'Spawn, query, list, and cancel background agents', (a) => {
      a
        .leaf('spawn', {
          description:
            'Spawn a background agent to run a task in parallel. ' +
            'Use this when you want to delegate a subtask while continuing your own work — ' +
            'e.g., kick off a test run, a code search, or a file refactor while you work on something else. ' +
            'Returns immediately with an instance_id (use agent/collect or agent/query to get results later). ' +
            'Pass await=true to block until the agent finishes and return its result directly.',
          requiredArgs: {
            task: { type: 'string', description: 'The task prompt the background agent should execute' },
          },
          optionalArgs: {
            systemPrompt: { type: 'string', description: 'Override the system prompt for this agent' },
            provider: { type: 'string', description: 'Provider override, e.g. "gemini", "anthropic"' },
            model: { type: 'string', description: 'Model override, e.g. "claude-haiku-4-5-20251001"' },
            role: { type: 'string', description: 'Prompt routing role: "planner", "actor", "summarizer". Uses the provider/model configured in promptRouting settings for that role.' },
            budget_usd: { type: 'number', description: 'USD budget ceiling; agent is cancelled if exceeded' },
            timeout_ms: { type: 'number', description: 'Timeout in milliseconds' },
            await: { type: 'boolean', description: 'Wait for completion and return the result; default false' },
            label: { type: 'string', description: 'Short label shown in the agents strip' },
          },
          handler: createAgentSpawnHandler(agentDeps),
        })
        .leaf('query', {
          description: 'Get status, cost, and (if finished) result of a background agent.',
          requiredArgs: {
            instance_id: { type: 'string', description: 'The id returned from agent/spawn' },
          },
          handler: createAgentQueryHandler(agentDeps),
        })
        .leaf('message', {
          description: 'Send a message to a specific agent (e.g. another chat panel).',
          requiredArgs: {
            agent_id: { type: 'string', description: 'The target agent ID' },
            message: { type: 'string', description: 'The message to send' }
          },
          handler: createAgentMessageHandler(agentDeps),
        })
        .leaf('list', {
          description: 'List background agents (running or complete).',
          optionalArgs: {
            filter: { type: 'string', description: '"running", "complete", or "all" (default)' },
          },
          handler: createAgentListHandler(agentDeps),
        })
        .leaf('cancel', {
          description: 'Cancel a running background agent.',
          requiredArgs: {
            instance_id: { type: 'string', description: 'The id of the agent to cancel' },
          },
          optionalArgs: {
            reason: { type: 'string', description: 'Short cancellation reason for logs/UI' },
          },
          handler: createAgentCancelHandler(agentDeps),
        })
        .leaf('batch', {
          description:
            'Spawn multiple background agents and wait for all to complete. ' +
            'This is your primary parallelism tool — reach for it whenever a task can be split into 2+ independent pieces. ' +
            'Examples: read/analyze multiple files, refactor several independent modules, run tests + lint simultaneously, ' +
            'search for different patterns across the codebase. ' +
            'Returns all results in one response. Default mode is parallel; sequential mode runs tasks one after another.',
          requiredArgs: {
            tasks: { type: 'json', description: 'Array of {task, label?, model?, provider?} objects' },
          },
          optionalArgs: {
            execution_mode: { type: 'string', description: '"parallel" (default) or "sequential"' },
            budget_usd: { type: 'number', description: 'Per-agent budget (default: $0.50)' },
            timeout_ms: { type: 'number', description: 'Per-agent timeout (default: 300000)' },
          },
          handler: createAgentBatchHandler(agentDeps),
        })
        .leaf('collect', {
          description:
            'Wait for multiple previously-spawned agents to complete and return all their results. ' +
            'Use after fire-and-forget agent/spawn calls when you are ready to use their results. ' +
            'Typical pattern: spawn 3 agents → do your own work → agent/collect all 3 before synthesizing.',
          requiredArgs: {
            instance_ids: { type: 'json', description: 'Array of agent instance IDs to await' },
          },
          optionalArgs: {
            timeout_ms: { type: 'number', description: 'Max time to wait (default: 60000)' },
          },
          handler: createAgentCollectHandler(agentDeps),
        });
    });
  }

  const root = builder.build();

  // Hierarchical memory (conversation → project → global). Replaces the
  // swiss-army-tool in-session scratchpad. Only wired when deps supplied.
  if (deps.memory) {
    const m = deps.memory;
    const memBranch = new BranchNode({
      name: 'memory',
      description:
        'Hierarchical memory: conversation (this session) → project (this workspace) → global (across workspaces). Use add/recall/list/promote/forget.',
    });
    memBranch.addChild(new LeafNode({
      name: 'add',
      description:
        'Save a durable note to this conversation\'s memory. Use memory/promote to move noteworthy entries up to project or global scope.',
      requiredArgs: {
        title: { type: 'string', description: 'Short label (e.g. "user prefers Python")' },
        body: { type: 'string', description: 'The fact or note to remember' },
      },
      optionalArgs: {
        tags: { type: 'string', description: 'Comma-separated tags (or an array)' },
        strength: { type: 'number', description: 'Importance 0-1 (default 0.7)' },
      },
      handler: createMemoryAddHandler(m),
    }));
    memBranch.addChild(new LeafNode({
      name: 'recall',
      description:
        'Retrieve relevant memories by semantic resonance. Returns top matches across conversation/project/global by default.',
      requiredArgs: {
        query: { type: 'string', description: 'Free-text query; tokens guide the match' },
      },
      optionalArgs: {
        scope: { type: 'string', description: '"conversation", "project", "global", or "all" (default)' },
        k: { type: 'number', description: 'Max number of results (default 5, max 20)' },
      },
      handler: createMemoryRecallHandler(m),
    }));
    memBranch.addChild(new LeafNode({
      name: 'promote',
      description:
        'Move an entry to a higher scope so it persists beyond this conversation/workspace. Use sparingly for high-value facts.',
      requiredArgs: {
        id: { type: 'string', description: 'The entry id from memory/add or memory/recall' },
        to: { type: 'string', description: 'Target scope: "project" or "global"' },
      },
      handler: createMemoryPromoteHandler(m),
    }));
    memBranch.addChild(new LeafNode({
      name: 'list',
      description: 'List the most recent entries in a given scope (default: conversation).',
      optionalArgs: {
        scope: { type: 'string', description: '"conversation" (default), "project", or "global"' },
        k: { type: 'number', description: 'Max entries (default 20, max 100)' },
      },
      handler: createMemoryListHandler(m),
    }));
    memBranch.addChild(new LeafNode({
      name: 'forget',
      description: 'Remove an entry from whichever scope it lives in.',
      requiredArgs: { id: { type: 'string', description: 'Entry id to remove' } },
      handler: createMemoryForgetHandler(m),
    }));
    root.addChild(memBranch);
  }

  const router = new Router(root, session, { debug: false });

  return { router, session };
}
