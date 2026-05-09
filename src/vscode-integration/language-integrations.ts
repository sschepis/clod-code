import * as vscode from 'vscode';
import type { Orchestrator } from '../agent/orchestrator';
import type { BaseProvider } from '@sschepis/llm-wrapper';
import { COMMANDS } from '../shared/constants';
import { logger } from '../shared/logger';

const MAX_URI_PROMPT_LENGTH = 4000;
const MAX_DOCUMENT_LINK_LINES = 10_000;
const MAX_INLINE_PROMPT_CHARS = 6000;
const INLINE_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// 1. Code Actions Provider — "Fix with Oboto" lightbulb
// ---------------------------------------------------------------------------

class ObotoCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly orchestrator: Orchestrator) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (context.diagnostics.length === 0) return [];

    const action = new vscode.CodeAction('Fix with Oboto', vscode.CodeActionKind.QuickFix);
    const diagnosticText = context.diagnostics
      .map((d) => `${d.source ? d.source + ': ' : ''}${d.message}`)
      .join('\n');

    const lastLine = document.lineCount - 1;
    const contextStart = Math.max(0, range.start.line - 3);
    const contextEnd = Math.min(lastLine, range.end.line + 3);
    const surroundingCode = document.getText(
      new vscode.Range(contextStart, 0, contextEnd, document.lineAt(contextEnd).text.length),
    );

    action.command = {
      title: 'Fix with Oboto',
      command: COMMANDS.FIX_WITH_OBOTO,
      arguments: [document.uri, diagnosticText, surroundingCode],
    };
    action.diagnostics = [...context.diagnostics];
    action.isPreferred = false;
    return [action];
  }
}

// ---------------------------------------------------------------------------
// 2. URI Handler — vscode://nomyx-inc.obotovs/...
// ---------------------------------------------------------------------------

class ObotoUriHandler implements vscode.UriHandler {
  constructor(private readonly orchestrator: Orchestrator) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    const path = uri.path;
    const params = new URLSearchParams(uri.query);

    if (path === '/chat') {
      let prompt = params.get('prompt');
      if (prompt) {
        if (prompt.length > MAX_URI_PROMPT_LENGTH) {
          prompt = prompt.slice(0, MAX_URI_PROMPT_LENGTH);
        }
        await vscode.commands.executeCommand(COMMANDS.FOCUS_CHAT);
        await this.orchestrator.submitToAgent('foreground', prompt);
      }
    } else if (path === '/surface') {
      const name = params.get('name');
      if (name) {
        this.orchestrator.getSurfaceManager().openPanel(name, false);
      }
    } else if (path === '/settings') {
      await vscode.commands.executeCommand(COMMANDS.OPEN_SETTINGS);
    } else if (path === '/welcome') {
      await vscode.commands.executeCommand(COMMANDS.SHOW_WELCOME);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Document Link Provider — clickable .obotovs/ paths
// ---------------------------------------------------------------------------

const OBOTOVS_PATH_RE = /\.obotovs\/(skills|surfaces|routes)\/([A-Za-z0-9_-]+)\.(md|html|js)/g;

class ObotoDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceFolder) return links;

    const lineCount = Math.min(document.lineCount, MAX_DOCUMENT_LINK_LINES);
    for (let i = 0; i < lineCount; i++) {
      if (token.isCancellationRequested) break;
      const lineText = document.lineAt(i).text;
      let match: RegExpExecArray | null;
      OBOTOVS_PATH_RE.lastIndex = 0;
      while ((match = OBOTOVS_PATH_RE.exec(lineText)) !== null) {
        const start = new vscode.Position(i, match.index);
        const end = new vscode.Position(i, match.index + match[0].length);
        const target = vscode.Uri.joinPath(workspaceFolder, match[0]);
        links.push(new vscode.DocumentLink(new vscode.Range(start, end), target));
      }
    }
    return links;
  }
}

// ---------------------------------------------------------------------------
// 4. Comment Thread Provider — inline code review annotations
// ---------------------------------------------------------------------------

class ObotoCommentController {
  private controller: vscode.CommentController;
  private threads: vscode.CommentThread[] = [];

  constructor() {
    this.controller = vscode.comments.createCommentController('oboto', 'Oboto Review');
    this.controller.commentingRangeProvider = undefined;
  }

  addReviewComment(uri: vscode.Uri, line: number, text: string): void {
    const range = new vscode.Range(line, 0, line, 0);
    const comment: vscode.Comment = {
      author: { name: 'Oboto' },
      body: new vscode.MarkdownString(text),
      mode: vscode.CommentMode.Preview,
    };
    const thread = this.controller.createCommentThread(uri, range, [comment]);
    this.threads.push(thread);
  }

  clearAll(): void {
    for (const thread of this.threads) thread.dispose();
    this.threads = [];
  }

  dispose(): void {
    this.clearAll();
    this.controller.dispose();
  }
}

// ---------------------------------------------------------------------------
// 5. Terminal Link Provider — click errors to auto-fix
// ---------------------------------------------------------------------------

interface ObotoTerminalLink extends vscode.TerminalLink {
  file?: string;
  fileLine?: number;
  errorText: string;
}

const FILE_LINE_RE = /(?:^|\s)((?:\.\/|src\/|lib\/|test\/)?[\w./-]+\.[a-z]{1,4})[:\s]+(?:line\s+)?(\d+)/i;
const ERROR_RE = /\b(Error|TypeError|SyntaxError|ReferenceError|FAIL)\b/;

class ObotoTerminalLinkProvider implements vscode.TerminalLinkProvider<ObotoTerminalLink> {
  constructor(private readonly orchestrator: Orchestrator) {}

  provideTerminalLinks(context: vscode.TerminalLinkContext): ObotoTerminalLink[] {
    const line = context.line;

    const fileMatch = FILE_LINE_RE.exec(line);
    if (fileMatch) {
      return [{
        startIndex: fileMatch.index,
        length: fileMatch[0].length,
        tooltip: 'Open file and fix with Oboto',
        file: fileMatch[1],
        fileLine: parseInt(fileMatch[2], 10),
        errorText: line,
      }];
    }

    if (ERROR_RE.test(line)) {
      return [{
        startIndex: 0,
        length: line.length,
        tooltip: 'Fix this error with Oboto',
        errorText: line,
      }];
    }

    return [];
  }

  async handleTerminalLink(link: ObotoTerminalLink): Promise<void> {
    if (link.file) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (workspaceFolder) {
        const fileUri = vscode.Uri.joinPath(workspaceFolder, link.file);
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, {
            selection: link.fileLine
              ? new vscode.Range(link.fileLine - 1, 0, link.fileLine - 1, 0)
              : undefined,
          });
        } catch {
          // file may not exist — proceed to submit error to agent
        }
      }
    }

    await vscode.commands.executeCommand(COMMANDS.FOCUS_CHAT);
    await this.orchestrator.submitToAgent(
      'foreground',
      `Fix this terminal error:\n\`\`\`\n${link.errorText}\n\`\`\``,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Chat Participant — @oboto in native VS Code Chat
// ---------------------------------------------------------------------------

function registerChatParticipant(
  context: vscode.ExtensionContext,
  orchestrator: Orchestrator,
): vscode.Disposable | undefined {
  if (typeof (vscode as any).chat?.createChatParticipant !== 'function') {
    logger.info('vscode.chat.createChatParticipant not available — skipping chat participant');
    return undefined;
  }

  try {
    const participant = (vscode as any).chat.createChatParticipant(
      'oboto',
      async (
        request: { prompt: string },
        _context: unknown,
        stream: { markdown: (text: string) => void },
        _token: vscode.CancellationToken,
      ) => {
        stream.markdown('Forwarding to Oboto agent...\n\n');
        await orchestrator.submitToAgent('foreground', request.prompt);
        stream.markdown('Prompt submitted to Oboto. Check the Oboto chat panel for the response.');
      },
    );
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png');
    return participant;
  } catch (err) {
    logger.warn('Failed to register chat participant', err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 7. Inline Completion Provider — ghost-text suggestions
// ---------------------------------------------------------------------------

class ObotoInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingResolve: ((items: vscode.InlineCompletionItem[]) => void) | undefined;
  private cachedProvider: BaseProvider | undefined;
  private cachedProviderKey: string | undefined;

  constructor(private readonly orchestrator: Orchestrator) {}

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    const enabled = vscode.workspace.getConfiguration('obotovs').get<boolean>('inlineCompletionsEnabled', false);
    if (!enabled) return [];

    // Cancel any pending debounced request
    this.cancelPending();

    if (token.isCancellationRequested) return [];

    return new Promise<vscode.InlineCompletionItem[]>((resolve) => {
      this.pendingResolve = resolve;

      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = undefined;
        this.pendingResolve = undefined;

        if (token.isCancellationRequested) {
          resolve([]);
          return;
        }

        const startLine = Math.max(0, position.line - 20);
        const endLine = Math.min(document.lineCount - 1, position.line + 5);
        const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
        const suffix = document.getText(
          new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length),
        );

        const cappedPrefix = prefix.length > MAX_INLINE_PROMPT_CHARS
          ? prefix.slice(-MAX_INLINE_PROMPT_CHARS)
          : prefix;
        const maxSuffix = MAX_INLINE_PROMPT_CHARS - cappedPrefix.length;
        const cappedSuffix = suffix.length > maxSuffix ? suffix.slice(0, maxSuffix) : suffix;

        try {
          const prompt =
            'Complete the following code. Return ONLY the completion text, no explanation, no markdown fencing.\n\n' +
            `Prefix:\n${cappedPrefix}\n\n[CURSOR]\n\nSuffix:\n${cappedSuffix}`;
          const completion = await this.requestCompletion(prompt, token);
          if (!completion || token.isCancellationRequested) {
            resolve([]);
            return;
          }
          resolve([new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))]);
        } catch {
          resolve([]);
        }
      }, INLINE_DEBOUNCE_MS);

      token.onCancellationRequested(() => this.cancelPending());
    });
  }

  private cancelPending(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.pendingResolve) {
      this.pendingResolve([]);
      this.pendingResolve = undefined;
    }
  }

  private async getProvider(): Promise<{ provider: BaseProvider; model: string } | undefined> {
    const { getSettings } = await import('../config/settings');
    const { createProviders, resolveRole } = await import('../agent/providers');
    const settings = getSettings();
    const resolved = resolveRole('coder', settings);
    const key = `${resolved.providerId}:${resolved.model}`;

    if (this.cachedProvider && this.cachedProviderKey === key) {
      return { provider: this.cachedProvider, model: resolved.model };
    }

    const { remote } = await createProviders(settings, 'coder');
    this.cachedProvider = remote;
    this.cachedProviderKey = key;
    return { provider: remote, model: resolved.model };
  }

  private async requestCompletion(prompt: string, token: vscode.CancellationToken): Promise<string | undefined> {
    try {
      const result = await this.getProvider();
      if (!result || token.isCancellationRequested) return undefined;

      const response = await result.provider.chat({
        model: result.model,
        messages: [{ role: 'user' as const, content: prompt }],
        max_tokens: 200,
        temperature: 0,
      });
      if (token.isCancellationRequested) return undefined;
      const raw = response?.choices?.[0]?.message?.content;
      if (typeof raw === 'string') return raw.trim();
      if (Array.isArray(raw)) {
        const text = raw.filter((p) => p.type === 'text').map((p) => p.text).join('');
        return text.trim() || undefined;
      }
      return undefined;
    } catch {
      this.cachedProvider = undefined;
      this.cachedProviderKey = undefined;
      return undefined;
    }
  }

  dispose(): void {
    this.cancelPending();
    this.cachedProvider = undefined;
    this.cachedProviderKey = undefined;
  }
}

// ---------------------------------------------------------------------------
// Top-level registration function
// ---------------------------------------------------------------------------

export function registerLanguageIntegrations(
  context: vscode.ExtensionContext,
  orchestrator: Orchestrator,
): { commentController: ObotoCommentController } {
  // 1. Code Actions
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new ObotoCodeActionProvider(orchestrator),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMANDS.FIX_WITH_OBOTO,
      async (_uri: vscode.Uri, diagnosticText: string, surroundingCode: string) => {
        await vscode.commands.executeCommand(COMMANDS.FOCUS_CHAT);
        await orchestrator.submitToAgent(
          'foreground',
          `Fix this error:\n\`\`\`\n${diagnosticText}\n\`\`\`\n\nContext:\n\`\`\`\n${surroundingCode}\n\`\`\``,
        );
      },
    ),
  );
  logger.info('Code action provider registered');

  // 2. URI Handler
  context.subscriptions.push(
    vscode.window.registerUriHandler(new ObotoUriHandler(orchestrator)),
  );
  logger.info('URI handler registered');

  // 3. Document Link Provider
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { scheme: 'file' },
      new ObotoDocumentLinkProvider(),
    ),
  );
  logger.info('Document link provider registered');

  // 4. Comment Controller
  const commentController = new ObotoCommentController();
  context.subscriptions.push({ dispose: () => commentController.dispose() });
  logger.info('Comment controller registered');

  // 5. Terminal Link Provider
  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider(new ObotoTerminalLinkProvider(orchestrator)),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMANDS.FIX_FROM_TERMINAL,
      async (errorText: string) => {
        await vscode.commands.executeCommand(COMMANDS.FOCUS_CHAT);
        await orchestrator.submitToAgent(
          'foreground',
          `Fix this terminal error:\n\`\`\`\n${errorText}\n\`\`\``,
        );
      },
    ),
  );
  logger.info('Terminal link provider registered');

  // 6. Chat Participant
  const chatParticipant = registerChatParticipant(context, orchestrator);
  if (chatParticipant) {
    context.subscriptions.push(chatParticipant);
    logger.info('Chat participant registered');
  }

  // 7. Inline Completion Provider
  const inlineProvider = new ObotoInlineCompletionProvider(orchestrator);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { scheme: 'file' },
      inlineProvider,
    ),
  );
  context.subscriptions.push({ dispose: () => inlineProvider.dispose() });
  logger.info('Inline completion provider registered');

  return { commentController };
}
