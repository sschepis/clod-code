import * as vscode from 'vscode';

const SUPPORTED_SYMBOL_KINDS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Constructor,
]);

export class ObotoCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    if (!symbols || symbols.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    this.collectLenses(document, symbols, lenses);
    return lenses;
  }

  private collectLenses(
    document: vscode.TextDocument,
    symbols: vscode.DocumentSymbol[],
    out: vscode.CodeLens[],
  ): void {
    for (const sym of symbols) {
      if (SUPPORTED_SYMBOL_KINDS.has(sym.kind)) {
        const range = sym.selectionRange;
        out.push(
          new vscode.CodeLens(range, {
            title: '$(sparkle) Ask Oboto',
            command: 'obotovs.codeLensAsk',
            arguments: [document.uri, range],
          }),
          new vscode.CodeLens(range, {
            title: '$(book) Explain',
            command: 'obotovs.codeLensExplain',
            arguments: [document.uri, range, sym.name],
          }),
        );
      }
      if (sym.children.length > 0) {
        this.collectLenses(document, sym.children, out);
      }
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

export function registerCodeLensCommands(
  context: vscode.ExtensionContext,
  submitToChat: (text: string) => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'obotovs.codeLensAsk',
      async (uri: vscode.Uri, range: vscode.Range) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const expandedRange = expandToFullSymbol(doc, range);
        const text = doc.getText(expandedRange);
        const question = await vscode.window.showInputBox({
          prompt: 'What would you like to ask about this code?',
          placeHolder: 'e.g., find bugs, optimize, add error handling...',
        });
        if (!question) return;
        const fileName = uri.fsPath.split(/[\\/]/).pop();
        const lineNum = range.start.line + 1;
        submitToChat(
          `${question}\n\nFrom \`${fileName}:${lineNum}\`:\n\`\`\`${doc.languageId}\n${text}\n\`\`\``,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'obotovs.codeLensExplain',
      async (uri: vscode.Uri, range: vscode.Range, symbolName: string) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const expandedRange = expandToFullSymbol(doc, range);
        const text = doc.getText(expandedRange);
        const fileName = uri.fsPath.split(/[\\/]/).pop();
        const lineNum = range.start.line + 1;
        submitToChat(
          `Explain the following \`${symbolName}\` from \`${fileName}:${lineNum}\`:\n\`\`\`${doc.languageId}\n${text}\n\`\`\``,
        );
      },
    ),
  );
}

function expandToFullSymbol(doc: vscode.TextDocument, selectionRange: vscode.Range): vscode.Range {
  const startLine = selectionRange.start.line;
  let endLine = startLine;
  let braceDepth = 0;
  let foundOpen = false;

  for (let i = startLine; i < doc.lineCount; i++) {
    const line = doc.lineAt(i).text;
    for (const ch of line) {
      if (ch === '{' || ch === '(') { braceDepth++; foundOpen = true; }
      if (ch === '}' || ch === ')') braceDepth--;
    }
    endLine = i;
    if (foundOpen && braceDepth <= 0) break;
    if (i - startLine > 200) break;
  }

  return new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
}
