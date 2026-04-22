import { createSystemObserveHandler } from '../tools/system-observe';
import { createSystemReloadHandler } from '../tools/system-reload';
import { loadDynamicTools } from './dynamic-tools';
import {
  TreeBuilder, SessionManager, Router, BranchNode, LeafNode,
  SessionNotes, createNotesMiddleware, createNotesModule,
  createRedirectMiddleware, STANDARD_REDIRECTS,
} from '@sschepis/swiss-army-tool';
import type { Middleware } from '@sschepis/swiss-army-tool';
import {
  createFileReadHandler, createFileWriteHandler, createFileEditHandler,
  createShellRunHandler, createShellBackgroundHandler,
  createGlobSearchHandler, createGrepSearchHandler,
  createGitStatusHandler, createGitDiffHandler, createGitLogHandler,
  createGitCommitHandler, createGitBranchHandler, createGitStashHandler,
  createGitReviewHandler, createGitReviewUncommittedHandler,
  createDiagnosticsHandler,
  createWorkspaceInfoHandler, createOpenFilesHandler,
  createTerminalHandler,
  createTerminalUiStateHandler,
  createAskHandler, createSecretHandler,
  createAgentSpawnHandler, createAgentQueryHandler, createAgentMessageHandler,
  createAgentListHandler, createAgentCancelHandler,
  createAgentBatchHandler, createAgentCollectHandler,
  createSurfaceListHandler, createSurfaceCreateHandler, createSurfaceUpdateHandler,
  createSurfaceDeleteHandler, createSurfaceOpenHandler, createSurfaceScreenshotHandler,
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
  createPlanProposeHandler, type PlanProposeDeps,
  createCodeSymbolsHandler,
  createCodeDefinitionHandler,
  createCodeReferencesHandler,
  createCodeHoverHandler,
  createCodeWorkspaceSymbolsHandler,
  createCodeExploreHandler,
  createCodeActionsHandler,
  createCodeFixHandler,
  createCodeRenameHandler,
  createCodeFormatHandler,
  createCodeCallHierarchyHandler,
  createCodeTypeHierarchyHandler,
  createCodeSignatureHandler,
  createCodeCompletionsHandler,
  createCodeInlayHintsHandler,
  createCodeMapHandler,
  type CodeMapDeps,
  createProjectInitHandler,
  createProjectListHandler,
  createProjectGetHandler,
  createProjectUpdateHandler,
  createProjectPlanCreateHandler,
  createProjectPlanUpdateHandler,
  createProjectPlanListHandler,
  createProjectTaskCreateHandler,
  createProjectTaskUpdateHandler,
  createProjectTaskListHandler,
  createProjectReviewCreateHandler,
  createProjectReviewUpdateHandler,
  createProjectStatusHandler,
  createProjectArchiveHandler,
  type ProjectToolDeps,
} from '../tools';
import {
  createAlephNetThinkHandler,
  createAlephNetRememberHandler,
  createAlephNetRecallHandler,
  createAlephNetChatHandler,
} from '../tools/alephnet-tools';

export interface ToolTreeResult {
  router: Router;
  session: SessionManager;
  notes: SessionNotes;
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
  /** Per-agent code intelligence exploration context. */
  codeMap?: CodeMapDeps;
  /** Workspace-scoped project manager — project management, plans, tasks, reviews. */
  project?: ProjectToolDeps;
  /** Plan proposal — saves plan, opens markdown preview, shows approval prompt. */
  planPropose?: PlanProposeDeps;
  /** Called when the agent writes or edits a file — used for AI-modified file decorations. */
  onFileChanged?: (filePath: string) => void;
}

/**
 * Build the swiss-army-tool command tree with all coding tools.
 * Returns the Router (for ObotoAgent) and SessionManager (for persistence).
 */
export function buildToolTree(deps: ToolTreeDeps): ToolTreeResult {
  const session = new SessionManager();
  const sessionNotes = new SessionNotes();

  const builder = TreeBuilder.create('root', 'Oboto VS coding assistant tool tree')
    // ── File operations ────────────────────────────────────────────
    .branch('file', 'Read, write, and edit files. Use file/read to inspect code (supports offset/limit for large files), file/write for new files, file/edit for surgical changes with exact-match replacement or line-anchored inserts. Prefer file/edit over file/write when modifying existing files — it is safer and supports undo.', (file) => {
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
          handler: createFileWriteHandler(deps.onFileChanged),
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
          handler: createFileEditHandler(deps.onFileChanged),
        });
    })

    // ── Search operations ──────────────────────────────────────────
    .branch('search', 'Find files and search code content. Use search/glob to find files by name pattern (e.g. "**/*.ts"), search/grep to search inside files by regex. For semantic code search (definitions, references, types), use the code module instead.', (search) => {
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

    // ── Code intelligence (VS Code language server) ─────────────
    .branch('code', 'Semantic code intelligence via VS Code language servers. ALWAYS use code/explore as your FIRST tool when investigating any code area. It returns symbols, type info, definitions, and call hierarchy in a single call.', (code) => {
      code
        .leaf('explore', {
          description: 'Deep-explore a file or symbol in ONE call. Returns: symbol outline, type info for exports, and (if symbol given) definition with context + call hierarchy. Use this FIRST before any file/read, search/grep, or other code/* calls. Replaces 10-20 sequential reads/greps.',
          requiredArgs: { path: { type: 'string', description: 'File path to explore' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Specific symbol to deep-dive on (gets definition, type info, call hierarchy)' },
            depth: { type: 'number', description: 'Exploration depth: 1 (symbols+hover), 2 (adds call hierarchy), 3 (adds references)', default: 2 },
          },
          handler: createCodeExploreHandler(deps.codeMap),
        })
        .leaf('symbols', {
          description: 'Get a file\'s symbol outline (functions, classes, interfaces, variables). Use instead of grep to understand file structure.',
          requiredArgs: { path: { type: 'string', description: 'File path (absolute or workspace-relative)' } },
          optionalArgs: {
            flat: { type: 'boolean', description: 'Flatten nested symbols into a flat list', default: false },
          },
          handler: createCodeSymbolsHandler(deps.codeMap),
        })
        .leaf('definition', {
          description: 'Go to definition of a symbol. Returns the definition location with surrounding code context. Accepts symbol name or line/column position.',
          requiredArgs: { path: { type: 'string', description: 'File containing the symbol reference' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Symbol name to find (preferred — scans file for this name)' },
            line: { type: 'number', description: 'Line number (1-based) — alternative to symbol' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
          },
          handler: createCodeDefinitionHandler(deps.codeMap),
        })
        .leaf('references', {
          description: 'Find all references to a symbol across the workspace. Shows each call site with the line of code.',
          requiredArgs: { path: { type: 'string', description: 'File containing the symbol' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Symbol name to find references for' },
            line: { type: 'number', description: 'Line number (1-based) — alternative to symbol' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
            max_results: { type: 'number', description: 'Max references to return', default: 30 },
          },
          handler: createCodeReferencesHandler(deps.codeMap),
        })
        .leaf('hover', {
          description: 'Get type information and documentation for a symbol. Shows the full type signature without reading the source.',
          requiredArgs: { path: { type: 'string', description: 'File containing the symbol' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Symbol name' },
            line: { type: 'number', description: 'Line number (1-based) — alternative to symbol' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
          },
          handler: createCodeHoverHandler(deps.codeMap),
        })
        .leaf('workspace-symbols', {
          description: 'Search for symbols by name across the entire workspace. Finds functions, classes, interfaces, etc. without knowing which file they are in.',
          requiredArgs: { query: { type: 'string', description: 'Symbol name or partial name to search for' } },
          optionalArgs: {
            max_results: { type: 'number', description: 'Max results', default: 30 },
          },
          handler: createCodeWorkspaceSymbolsHandler(deps.codeMap),
        })
        .leaf('map', {
          description: 'View your accumulated exploration context. Shows files explored, symbols discovered, and relationships found. Use scope="frontier" to see referenced-but-unexplored files.',
          optionalArgs: {
            scope: { type: 'string', description: 'Query scope: summary (default), file, symbol, relations, frontier' },
            query: { type: 'string', description: 'File path or symbol name to query (required for file/symbol/relations scopes)' },
          },
          handler: deps.codeMap
            ? createCodeMapHandler(deps.codeMap)
            : async () => '[INFO] Code map is not available in this context.',
        })
        .leaf('actions', {
          description: 'List available code actions / quick fixes at a position or range (auto-import, extract method, fix errors). Use code/fix to apply one.',
          requiredArgs: { path: { type: 'string', description: 'File path' } },
          optionalArgs: {
            line: { type: 'number', description: 'Line number (1-based). Omit to scan whole file.' },
            end_line: { type: 'number', description: 'End line for range' },
            kind: { type: 'string', description: 'Filter by CodeActionKind (e.g., "quickfix", "refactor.extract")' },
          },
          handler: createCodeActionsHandler(),
        })
        .leaf('fix', {
          description: 'Apply a code action by title. Use code/actions first to see available actions, then pass the title here.',
          requiredArgs: {
            path: { type: 'string', description: 'File path' },
            title: { type: 'string', description: 'Action title (exact or partial match)' },
          },
          optionalArgs: {
            line: { type: 'number', description: 'Line number to narrow the search' },
            end_line: { type: 'number', description: 'End line for range' },
          },
          handler: createCodeFixHandler(),
        })
        .leaf('rename', {
          description: 'Rename a symbol across all files in the workspace. Safe, language-aware rename (not text replace).',
          requiredArgs: {
            path: { type: 'string', description: 'File containing the symbol' },
            new_name: { type: 'string', description: 'New name for the symbol' },
          },
          optionalArgs: {
            symbol: { type: 'string', description: 'Current symbol name to rename' },
            line: { type: 'number', description: 'Line number (1-based) — alternative to symbol' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
          },
          handler: createCodeRenameHandler(),
        })
        .leaf('format', {
          description: 'Format a document or range using the configured formatter (Prettier, ESLint, etc.).',
          requiredArgs: { path: { type: 'string', description: 'File path' } },
          optionalArgs: {
            line: { type: 'number', description: 'Start line (1-based) for range formatting' },
            end_line: { type: 'number', description: 'End line for range formatting' },
            tab_size: { type: 'number', description: 'Tab size', default: 2 },
            insert_spaces: { type: 'boolean', description: 'Use spaces instead of tabs', default: true },
          },
          handler: createCodeFormatHandler(),
        })
        .leaf('calls', {
          description: 'Show call hierarchy — who calls this function (incoming) and what it calls (outgoing). Much faster than grep for tracing call chains.',
          requiredArgs: { path: { type: 'string', description: 'File containing the function' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Function name' },
            line: { type: 'number', description: 'Line number (1-based) — alternative to symbol' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
            direction: { type: 'string', description: '"incoming", "outgoing", or "both" (default)', default: 'both' },
          },
          handler: createCodeCallHierarchyHandler(deps.codeMap),
        })
        .leaf('types', {
          description: 'Show type hierarchy — supertypes (what this extends/implements) and subtypes (what extends/implements this).',
          requiredArgs: { path: { type: 'string', description: 'File containing the class or interface' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Class or interface name' },
            line: { type: 'number', description: 'Line number (1-based) — alternative to symbol' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
            direction: { type: 'string', description: '"supertypes", "subtypes", or "both" (default)', default: 'both' },
          },
          handler: createCodeTypeHierarchyHandler(deps.codeMap),
        })
        .leaf('signature', {
          description: 'Get function signature help — parameter names, types, and docs. Position the cursor inside a function call.',
          requiredArgs: { path: { type: 'string', description: 'File path' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Symbol at call site' },
            line: { type: 'number', description: 'Line number (1-based)' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
            trigger_character: { type: 'string', description: 'Trigger character (e.g., "(", ",")' },
          },
          handler: createCodeSignatureHandler(),
        })
        .leaf('completions', {
          description: 'Get code completions at a position. Shows what the language server suggests — useful for validating code or discovering available APIs.',
          requiredArgs: { path: { type: 'string', description: 'File path' } },
          optionalArgs: {
            symbol: { type: 'string', description: 'Partial text at the completion point' },
            line: { type: 'number', description: 'Line number (1-based)' },
            column: { type: 'number', description: 'Column number (1-based)', default: 1 },
            trigger_character: { type: 'string', description: 'Trigger character (e.g., ".")' },
            max_results: { type: 'number', description: 'Max completions to return', default: 20 },
          },
          handler: createCodeCompletionsHandler(),
        })
        .leaf('inlay-hints', {
          description: 'Get inlay hints (inferred types, parameter names) for a file or range. Shows type annotations the editor would display inline.',
          requiredArgs: { path: { type: 'string', description: 'File path' } },
          optionalArgs: {
            line: { type: 'number', description: 'Start line (1-based)' },
            end_line: { type: 'number', description: 'End line' },
          },
          handler: createCodeInlayHintsHandler(),
        });
    })

    // ── Shell execution ───────────────────────────────────────────
    .branch('shell', 'Execute shell commands for builds, tests, installs, and other CLI tasks. shell/run executes and returns output, shell/background for long-running processes (dev servers, watchers), shell/terminal to interact with the VS Code integrated terminal. Prefer dedicated tools (file/*, git/*, search/*) over shell when they cover the need.', (shell) => {
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
            name: { type: 'string', description: 'Terminal name', default: 'Oboto VS' },
          },
          handler: createTerminalHandler(),
        })
        .leaf('state', {
          description: 'Get the state of all open VS Code terminals.',
          handler: createTerminalUiStateHandler(),
        });
    })

    // ── Git operations ────────────────────────────────────────────
    .branch('git', 'Git version control: status, diff, log, commit, branch, stash. Check git/status before committing to see what is staged. Use git/diff to review changes before committing. Use git/log to understand recent history.', (git) => {
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
        })
        .leaf('review', {
          description: 'Review current branch changes vs base branch. Gathers the diff, detects the base branch, and returns a structured review prompt. Then produce a code review based on the prompt.',
          optionalArgs: {
            base: { type: 'string', description: 'Base branch to diff against (default: auto-detect main/master/dev/develop)' },
          },
          handler: createGitReviewHandler(),
        })
        .leaf('review-uncommitted', {
          description: 'Review all uncommitted changes (staged + unstaged). Gathers the diff against HEAD and returns a structured review prompt. Then produce a code review based on the prompt.',
          handler: createGitReviewUncommittedHandler(),
        });
    })

    // ── Plan transition ────────────────────────────
    .branch('plan', 'Propose a plan to the user before executing complex multi-step work. Use plan/propose to show your plan and get approval — the user can accept, reject, or modify. If accepted, mode transitions automatically to act mode.', (p) => {
      p.leaf('propose', {
        description: 'Propose a plan to the user and transition from plan to act mode. If accepted, the mode transitions to act mode automatically.',
        requiredArgs: {
          plan: { type: 'string', description: 'The proposed plan to show the user' },
        },
        handler: deps.planPropose
          ? createPlanProposeHandler(deps.planPropose, deps.agent)
          : createPlanProposeHandler(deps.planPropose!, deps.agent),
      });
    })


    // ── System ─────────────────────────────────────────────────────
    .branch('system', 'System operations: conversation observer and tool tree reload. Session notes are available under the `notes` module.', (sys) => {
      sys.leaf('observe', {
        description: 'Wait for and return new events from the target chat session. Used by subconscious background agents to monitor the conversation.',
        handler: async () => {
          if (!deps.agent) return '[ERROR] Agent deps not available';
          return await createSystemObserveHandler(deps.agent)();
        }
      });
      sys.leaf('reload', {
        description: 'Reload the agent tool tree. Call this after creating or modifying a custom tool in .obotovs/tools/ to instantly gain access to it without restarting.',
        handler: async (kwargs) => {
          if (!deps.agent) return '[ERROR] Agent deps not available';
          return await createSystemReloadHandler(deps.agent)();
        }
      });
    })
    // ── User interaction (ask, secrets) ────────────────────────────
    .branch('user', 'Interact with the user directly. user/ask presents a multiple-choice question (for decisions and confirmations). user/secret prompts for sensitive values like API keys (never ask for secrets in plain text — always use this). Values from user/secret are auto-saved to .env.', (u) => {
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
    .branch('chat', 'Control the chat window. Use chat/set_title to give this conversation a meaningful name based on the topic being discussed — helps the user identify conversations in the sidebar.', (chat) => {
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
    });

    // ── Projects (project management, plans, tasks, reviews) ─────────
    if (deps.project) {
      const projectDeps = deps.project;
      builder.branch('project', [
        'Project management: initialize, plan, track tasks, review code, and audit progress.',
        '',
        'Use project/init to scaffold a new or existing project.',
        'Use project/plan to create detailed implementation plans.',
        'Use project/task to track individual work items.',
        'Use project/review to record code reviews.',
        'Use project/status for a dashboard summary.',
        '',
        'All plans, tasks, and reviews are persisted in .obotovs/projects/.',
        'Plans should be detailed enough for third-party execution.',
        'All executed work generates auditable task lists.',
      ].join('\n'), (p) => {
        p
          .leaf('init', {
            description: 'Initialize a new or existing project. For existing-codebase type, automatically scans for conventions.',
            requiredArgs: {
              name: { type: 'string', description: 'Project name' },
              type: { type: 'string', description: 'Project type: "new-build", "existing-codebase", or "ad-hoc"' },
            },
            optionalArgs: {
              description: { type: 'string', description: 'Brief project description' },
              scan_conventions: { type: 'boolean', description: 'Auto-detect conventions for existing-codebase type (default: true)' },
            },
            handler: createProjectInitHandler(projectDeps),
          })
          .leaf('list', {
            description: 'List all projects in this workspace.',
            handler: createProjectListHandler(projectDeps),
          })
          .leaf('get', {
            description: 'Get detailed dashboard for a project (plans, tasks, reviews, conventions).',
            requiredArgs: {
              id: { type: 'string', description: 'Project ID (slug)' },
            },
            handler: createProjectGetHandler(projectDeps),
          })
          .leaf('update', {
            description: 'Update project metadata, status, conventions, or guidelines.',
            requiredArgs: {
              id: { type: 'string', description: 'Project ID' },
            },
            optionalArgs: {
              name: { type: 'string', description: 'New name' },
              description: { type: 'string', description: 'New description' },
              status: { type: 'string', description: 'New status: draft, active, paused, completed' },
              conventions: { type: 'string', description: 'JSON array of conventions' },
              guidelines: { type: 'string', description: 'JSON array of guideline strings' },
            },
            handler: createProjectUpdateHandler(projectDeps),
          })
          .leaf('plan', {
            description: 'Create a new implementation plan for a project. Plans should be detailed enough for third-party execution.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
              title: { type: 'string', description: 'Plan title' },
            },
            optionalArgs: {
              objective: { type: 'string', description: 'What the plan achieves' },
              scope: { type: 'string', description: 'What is in/out of scope' },
              steps: { type: 'string', description: 'JSON array of PlanStep objects' },
              test_strategy: { type: 'string', description: 'How to verify the plan is complete' },
              markdown: { type: 'string', description: 'Full markdown plan document' },
            },
            handler: createProjectPlanCreateHandler(projectDeps),
          })
          .leaf('plan-update', {
            description: 'Update an existing plan (status, steps, etc.).',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
              plan_id: { type: 'string', description: 'Plan ID (slug)' },
            },
            optionalArgs: {
              status: { type: 'string', description: 'New status: draft, approved, in-progress, completed' },
              title: { type: 'string', description: 'Updated title' },
              objective: { type: 'string', description: 'Updated objective' },
              scope: { type: 'string', description: 'Updated scope' },
              steps: { type: 'string', description: 'Updated JSON array of PlanStep objects' },
              test_strategy: { type: 'string', description: 'Updated test strategy' },
              markdown: { type: 'string', description: 'Updated markdown body' },
            },
            handler: createProjectPlanUpdateHandler(projectDeps),
          })
          .leaf('plan-list', {
            description: 'List all plans for a project, optionally filtered by status.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
            },
            optionalArgs: {
              status: { type: 'string', description: 'Filter by status' },
            },
            handler: createProjectPlanListHandler(projectDeps),
          })
          .leaf('task', {
            description: 'Create a task to track work done. Use for audit trails of completed work.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
              description: { type: 'string', description: 'What was done or needs to be done' },
            },
            optionalArgs: {
              plan_id: { type: 'string', description: 'Link task to a plan' },
              plan_step_id: { type: 'string', description: 'Link task to a specific plan step' },
              status: { type: 'string', description: 'Task status: pending, in-progress, completed, blocked, skipped' },
              assignee: { type: 'string', description: 'Who is doing this (agent ID or "user")' },
              result: { type: 'string', description: 'What was accomplished' },
              notes: { type: 'string', description: 'Additional context' },
            },
            handler: createProjectTaskCreateHandler(projectDeps),
          })
          .leaf('task-update', {
            description: 'Update a task status or add results.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
              task_id: { type: 'string', description: 'Task ID' },
            },
            optionalArgs: {
              status: { type: 'string', description: 'New status' },
              result: { type: 'string', description: 'What was accomplished' },
              notes: { type: 'string', description: 'Additional context' },
              assignee: { type: 'string', description: 'Who did this' },
            },
            handler: createProjectTaskUpdateHandler(projectDeps),
          })
          .leaf('task-list', {
            description: 'List tasks for a project, optionally filtered by plan or status.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
            },
            optionalArgs: {
              plan_id: { type: 'string', description: 'Filter by plan' },
              status: { type: 'string', description: 'Filter by status' },
            },
            handler: createProjectTaskListHandler(projectDeps),
          })
          .leaf('review', {
            description: 'Record a code review with findings. Use after implementing features to audit quality.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
              title: { type: 'string', description: 'Review title' },
            },
            optionalArgs: {
              plan_id: { type: 'string', description: 'Link review to a plan' },
              reviewed_files: { type: 'string', description: 'JSON array of file paths reviewed' },
              findings: { type: 'string', description: 'JSON array of ReviewFinding objects with severity, file, line, description, resolved' },
              summary: { type: 'string', description: 'Overall review summary' },
              status: { type: 'string', description: 'Review status: pending, approved, changes-requested, completed' },
            },
            handler: createProjectReviewCreateHandler(projectDeps),
          })
          .leaf('review-update', {
            description: 'Update a review status or add findings.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
              review_id: { type: 'string', description: 'Review ID' },
            },
            optionalArgs: {
              status: { type: 'string', description: 'New status' },
              summary: { type: 'string', description: 'Updated summary' },
              findings: { type: 'string', description: 'Updated JSON array of findings' },
            },
            handler: createProjectReviewUpdateHandler(projectDeps),
          })
          .leaf('status', {
            description: 'Get a formatted dashboard summary of a project: plans, tasks, reviews, conventions.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
            },
            handler: createProjectStatusHandler(projectDeps),
          })
          .leaf('archive', {
            description: 'Archive a completed project. Moves all plans, tasks, and reviews to archive/ for permanent record.',
            requiredArgs: {
              project_id: { type: 'string', description: 'Project ID' },
            },
            handler: createProjectArchiveHandler(projectDeps),
          });
      });
    }

    builder
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
        })
        .leaf('screenshot', {
          description: [
            'Capture a screenshot of an open surface\'s rendered output.',
            'Returns the screenshot as a PNG image that you can see.',
            'The surface must be open in a webview panel first (use surface/open if needed).',
            'Use this to see what the user sees when viewing a surface, to verify visual output, or to debug layout issues.',
          ].join(' '),
          requiredArgs: { name: { type: 'string', description: 'Surface name to screenshot (must be open)' } },
          optionalArgs: { label: { type: 'string', description: 'Optional label for the screenshot file (defaults to surface-name-timestamp)' } },
          handler: createSurfaceScreenshotHandler(deps.surface),
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
    .branch('peer', 'Coordinate across VS Code windows. peer/list shows this window\'s agents and other Oboto VS windows. peer/send messages agents in this window. peer/dispatch sends tasks to other windows (requires user approval). peer/ask asks the other window\'s user a question. Use peer/debug to diagnose connectivity issues.', (p) => {
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

    .branch('vscode', 'Execute any VS Code command by ID — a powerful escape hatch for actions not covered by other tools. Use vscode/list to discover commands (supports filtering), then vscode/run to execute. Use sparingly — prefer dedicated tools (file/*, code/*, git/*) when they cover the need.', (v) => {
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
    .branch('alephnet', 'Interact with the AlephNet Distributed Sentience Network. Use alephnet/think for semantic analysis, remember/recall for GMF storage, and chat to message other agents.', (v) => {
      v
        .leaf('think', {
          description: 'Run semantic analysis on a text or concept.',
          requiredArgs: { text: { type: 'string', description: 'Text to analyze' } },
          handler: createAlephNetThinkHandler(),
        })
        .leaf('remember', {
          description: 'Store a concept in the Global Memory Field.',
          requiredArgs: { concept: { type: 'string', description: 'Name of the concept' }, content: { type: 'string', description: 'Content to store' } },
          handler: createAlephNetRememberHandler(),
        })
        .leaf('recall', {
          description: 'Query the Global Memory Field.',
          requiredArgs: { query: { type: 'string', description: 'Search query' } },
          optionalArgs: { threshold: { type: 'number', description: 'Similarity threshold (0.0 - 1.0)' } },
          handler: createAlephNetRecallHandler(),
        })
        .leaf('chat', {
          description: 'Send a direct message to another agent on the AlephNet mesh.',
          requiredArgs: { peerId: { type: 'string', description: 'Target agent node ID' }, message: { type: 'string', description: 'Message content' } },
          handler: createAlephNetChatHandler(),
        });
    })

    // ── Workspace ─────────────────────────────────────────────────
    .branch('workspace', 'VS Code workspace state: diagnostics (TypeScript/lint errors and warnings), workspace info (root path, folders), and open editor tabs. Check workspace/diagnostics after making code changes to verify they compile cleanly.', (ws) => {
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
    builder.branch('agent', 'Spawn background agents for parallel work. Use agent/spawn to delegate independent subtasks (file searches, refactors, test runs) while you continue working. Use agent/batch to run multiple tasks and wait for all results. Use agent/collect to gather results from previously-spawned agents. Always prefer parallelism when tasks are independent — it is dramatically faster.', (a) => {
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
            role: { type: 'string', description: 'Prompt routing role: "planner", "actor", "summarizer", "coder". Uses the provider/model configured in promptRouting settings for that role.' },
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
        'Hierarchical memory system — USE THIS ACTIVELY. Start every task with memory/recall to check for relevant context from past work. ' +
        'Save discoveries, user preferences, architectural decisions, and task outcomes with memory/add. ' +
        'Three scopes: conversation (this session, default), project (persists across conversations in this workspace), global (across all workspaces). ' +
        'Use memory/promote to elevate important facts to project or global scope. ' +
        'Good memory hygiene means you never lose context across sessions and your assistance improves over time.',
    });
    memBranch.addChild(new LeafNode({
      name: 'add',
      description:
        'Save a fact, preference, or discovery to conversation memory. Do this proactively — save user preferences, architectural decisions, task outcomes, and anything that would be useful in future conversations. Use memory/promote afterward to elevate important facts to project or global scope.',
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
        'Retrieve relevant memories by semantic resonance. Call this at the START of every new task to check for prior context — user preferences, past decisions, project knowledge. Returns top matches across conversation/project/global by default. Also useful mid-task to recall specific facts.',
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
        'Move an entry to a higher scope. Promote to "project" for facts relevant to this workspace (architecture, conventions, ongoing work). Promote to "global" for facts that apply everywhere (user preferences, role, general knowledge). Promoted facts persist across conversations.',
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


  // ── Dynamic Custom Tools ──────────────────────────────────────────
  const dynamicTools = loadDynamicTools();
  if (dynamicTools.length > 0) {
    const customBranch = new BranchNode({ name: 'custom', description: 'Workspace-specific custom tools loaded from .obotovs/tools/*.js' });
    for (const t of dynamicTools) {
      customBranch.addChild(new LeafNode({
        name: t.name,
        description: t.description,
        requiredArgs: (t.requiredArgs || {}) as Record<string, import('@sschepis/swiss-army-tool').ArgDescriptor>,
        optionalArgs: (t.optionalArgs || {}) as Record<string, import('@sschepis/swiss-army-tool').ArgDescriptor>,
        handler: async (kwargs) => {
          if (!deps.agent) return '[ERROR] Agent deps not available for custom tool';
          return await t.handler(kwargs, deps.agent);
        },
      }));
    }
    root.addChild(customBranch);
  }

  // Session notes: auto-captured command log + AI observations
  root.addChild(createNotesModule(sessionNotes));

  const router = new Router(root, session, { debug: false });

  // Middleware: auto-capture tool responses into session notes
  router.use(createNotesMiddleware(sessionNotes));
  // Middleware: block shell commands that have dedicated tools
  router.use(createRedirectMiddleware(STANDARD_REDIRECTS));

  return { router, session, notes: sessionNotes };
}
