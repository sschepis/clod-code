import * as vscode from 'vscode';
import type { CodeMapDeps } from './code-map';

const TIMEOUT_MS = 10_000;
const MAX_CONTEXT_LINES = 10;

function resolveUri(filePath: string): vscode.Uri {
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  if (filePath.startsWith('/')) return vscode.Uri.file(filePath);
  return vscode.Uri.file(rootPath ? `${rootPath}/${filePath}` : filePath);
}

function relPath(absPath: string): string {
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  return rootPath && absPath.startsWith(rootPath) ? absPath.slice(rootPath.length + 1) : absPath;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    clearTimeout(timer!);
  }
}

async function resolvePosition(
  doc: vscode.TextDocument,
  kwargs: Record<string, unknown>,
): Promise<vscode.Position | string> {
  if (typeof kwargs.symbol === 'string') {
    const text = doc.getText();
    const symbolName = kwargs.symbol as string;
    // Try word-boundary match first
    const wordPattern = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const match = wordPattern.exec(text);
    if (match) return doc.positionAt(match.index);
    // Fall back to indexOf
    const idx = text.indexOf(symbolName);
    if (idx >= 0) return doc.positionAt(idx);
    return `[ERROR] Symbol "${symbolName}" not found in ${relPath(doc.uri.fsPath)}. Check the name and try again.`;
  }
  const line = Number(kwargs.line) - 1; // convert 1-based to 0-based
  const col = Number(kwargs.column || 1) - 1;
  if (line < 0 || line >= doc.lineCount) {
    return `[ERROR] Line ${kwargs.line} is out of range (file has ${doc.lineCount} lines).`;
  }
  return new vscode.Position(line, col);
}

const SYMBOL_KIND_NAMES: Record<number, string> = {
  [vscode.SymbolKind.File]: 'File',
  [vscode.SymbolKind.Module]: 'Module',
  [vscode.SymbolKind.Namespace]: 'Namespace',
  [vscode.SymbolKind.Package]: 'Package',
  [vscode.SymbolKind.Class]: 'Class',
  [vscode.SymbolKind.Method]: 'Method',
  [vscode.SymbolKind.Property]: 'Property',
  [vscode.SymbolKind.Field]: 'Field',
  [vscode.SymbolKind.Constructor]: 'Constructor',
  [vscode.SymbolKind.Enum]: 'Enum',
  [vscode.SymbolKind.Interface]: 'Interface',
  [vscode.SymbolKind.Function]: 'Function',
  [vscode.SymbolKind.Variable]: 'Variable',
  [vscode.SymbolKind.Constant]: 'Constant',
  [vscode.SymbolKind.String]: 'String',
  [vscode.SymbolKind.Number]: 'Number',
  [vscode.SymbolKind.Boolean]: 'Boolean',
  [vscode.SymbolKind.Array]: 'Array',
  [vscode.SymbolKind.Object]: 'Object',
  [vscode.SymbolKind.Key]: 'Key',
  [vscode.SymbolKind.Null]: 'Null',
  [vscode.SymbolKind.EnumMember]: 'EnumMember',
  [vscode.SymbolKind.Struct]: 'Struct',
  [vscode.SymbolKind.Event]: 'Event',
  [vscode.SymbolKind.Operator]: 'Operator',
  [vscode.SymbolKind.TypeParameter]: 'TypeParameter',
};

function symbolKindName(kind: vscode.SymbolKind): string {
  return SYMBOL_KIND_NAMES[kind] || 'Unknown';
}

function formatSymbol(sym: vscode.DocumentSymbol, indent: number): string[] {
  const pad = '  '.repeat(indent);
  const range = sym.range;
  const startLine = range.start.line + 1;
  const endLine = range.end.line + 1;
  const lines = [`${pad}${sym.name} (${symbolKindName(sym.kind)}) L${startLine}-L${endLine}`];
  for (const child of sym.children) {
    lines.push(...formatSymbol(child, indent + 1));
  }
  return lines;
}

function flattenSymbols(
  syms: vscode.DocumentSymbol[],
  filePath: string,
  container?: string,
): Array<{ id: string; name: string; kind: string; line: number; endLine: number; container?: string }> {
  const result: Array<{ id: string; name: string; kind: string; line: number; endLine: number; container?: string }> = [];
  for (const sym of syms) {
    const name = container ? `${container}.${sym.name}` : sym.name;
    result.push({
      id: `${filePath}::${name}`,
      name: sym.name,
      kind: symbolKindName(sym.kind),
      line: sym.range.start.line + 1,
      endLine: sym.range.end.line + 1,
      container,
    });
    result.push(...flattenSymbols(sym.children, filePath, name));
  }
  return result;
}

async function readContext(uri: vscode.Uri, line: number, before: number, after: number): Promise<string> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const startLine = Math.max(0, line - before);
    const endLine = Math.min(doc.lineCount - 1, line + after);
    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(`${String(i + 1).padStart(6)}  ${doc.lineAt(i).text}`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

function extractHoverText(hovers: vscode.Hover[]): string {
  const parts: string[] = [];
  for (const hover of hovers) {
    for (const content of hover.contents) {
      if (typeof content === 'string') {
        parts.push(content);
      } else if (content instanceof vscode.MarkdownString) {
        let text = content.value;
        // Strip markdown code fences for cleaner LLM consumption
        text = text.replace(/```\w*\n?/g, '').replace(/```/g, '');
        parts.push(text.trim());
      } else if ('value' in content) {
        parts.push((content as { value: string }).value);
      }
    }
  }
  return parts.join('\n\n');
}

const NO_LANG_SERVER = (tool: string, path: string) =>
  `[INFO] ${tool} returned no results for ${path}. Possible causes:\n` +
  '  1. No language server is active for this file type — try opening it in the editor first\n' +
  '  2. The language server is still initializing — wait a moment and retry\n' +
  '  3. Use search/grep as a fallback for text-based search';

// ── Handlers ──────────────────────────────────────────────────────────

export function createCodeSymbolsHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const flat = kwargs.flat === true || kwargs.flat === 'true';

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri,
      )),
      TIMEOUT_MS,
      'executeDocumentSymbolProvider',
    );

    if (!result || result.length === 0) {
      return NO_LANG_SERVER('code/symbols', relPath(doc.uri.fsPath));
    }

    const rel = relPath(doc.uri.fsPath);

    // Record to code map
    if (mapDeps) {
      const map = mapDeps.getMap();
      map.recordFile(rel, doc.languageId, result.length);
      for (const s of flattenSymbols(result, rel)) {
        map.recordSymbol({
          id: s.id,
          name: s.name,
          kind: s.kind,
          file: rel,
          line: s.line,
          endLine: s.endLine,
          discoveredBy: 'code/symbols',
        });
      }
    }

    if (flat) {
      const flattened = flattenSymbols(result, rel);
      const lines = [`[SYMBOLS] ${rel} (${flattened.length} symbols, flat)`, ''];
      for (const s of flattened) {
        lines.push(`  ${s.name} (${s.kind}) L${s.line}-L${s.endLine}`);
      }
      return lines.join('\n');
    }

    const lines = [`[SYMBOLS] ${rel} (${result.length} top-level symbols)`, ''];
    for (const sym of result) {
      lines.push(...formatSymbol(sym, 1));
    }
    return lines.join('\n');
  };
}

export function createCodeDefinitionHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'executeDefinitionProvider',
    );

    if (!result || result.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : ` at ${kwargs.line}:${kwargs.column || 1}`;
      return NO_LANG_SERVER(`code/definition${sym}`, relPath(doc.uri.fsPath));
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const rel = relPath(doc.uri.fsPath);
    const lines: string[] = [`[DEFINITION] ${label}`, ''];

    for (const loc of result.slice(0, 5)) {
      const targetRel = relPath(loc.uri.fsPath);
      const targetLine = loc.range.start.line;
      lines.push(`Defined at: ${targetRel}:${targetLine + 1}:${loc.range.start.character + 1}`);

      const context = await readContext(loc.uri, targetLine, 1, MAX_CONTEXT_LINES);
      if (context) {
        lines.push('');
        lines.push(context);
        lines.push('');
      }

      // Record to code map
      if (mapDeps) {
        const map = mapDeps.getMap();
        const symName = kwargs.symbol ? String(kwargs.symbol) : label;
        const targetId = `${targetRel}::${symName}`;
        const sourceId = `${rel}::${symName}`;
        map.touchFile(targetRel);
        map.recordSymbol({
          id: targetId,
          name: symName,
          kind: 'Unknown',
          file: targetRel,
          line: targetLine + 1,
          discoveredBy: 'code/definition',
        });
        if (targetRel !== rel) {
          map.recordRelation({
            from: sourceId,
            to: targetId,
            kind: 'defines',
            file: targetRel,
            line: targetLine + 1,
          });
        }
      }
    }

    if (result.length > 5) {
      lines.push(`... and ${result.length - 5} more definition(s)`);
    }

    return lines.join('\n');
  };
}

export function createCodeReferencesHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const maxResults = Number(kwargs.max_results || 30);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'executeReferenceProvider',
    );

    if (!result || result.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : ` at ${kwargs.line}:${kwargs.column || 1}`;
      return NO_LANG_SERVER(`code/references${sym}`, relPath(doc.uri.fsPath));
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const lines: string[] = [`[REFERENCES] ${label} — ${result.length} reference(s)`, ''];

    // Group by file
    const byFile = new Map<string, vscode.Location[]>();
    for (const loc of result) {
      const key = relPath(loc.uri.fsPath);
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(loc);
    }

    let count = 0;
    for (const [file, locs] of byFile) {
      if (count >= maxResults) break;
      lines.push(`  ${file}:`);
      for (const loc of locs) {
        if (count >= maxResults) break;
        const lineNum = loc.range.start.line;
        try {
          const refDoc = await vscode.workspace.openTextDocument(loc.uri);
          const lineText = refDoc.lineAt(lineNum).text.trim();
          lines.push(`    L${lineNum + 1}: ${lineText}`);
        } catch {
          lines.push(`    L${lineNum + 1}`);
        }
        count++;

        // Record to code map
        if (mapDeps) {
          const map = mapDeps.getMap();
          const symName = kwargs.symbol ? String(kwargs.symbol) : label;
          map.touchFile(file);
          map.recordRelation({
            from: `${file}::${symName}`,
            to: `${relPath(doc.uri.fsPath)}::${symName}`,
            kind: 'references',
            file,
            line: lineNum + 1,
          });
        }
      }
    }

    if (result.length > maxResults) {
      lines.push('');
      lines.push(`... ${result.length - maxResults} more reference(s) omitted (increase max_results to see all)`);
    }

    return lines.join('\n');
  };
}

export function createCodeHoverHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'executeHoverProvider',
    );

    if (!result || result.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : ` at ${kwargs.line}:${kwargs.column || 1}`;
      return NO_LANG_SERVER(`code/hover${sym}`, relPath(doc.uri.fsPath));
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const rel = relPath(doc.uri.fsPath);
    const hoverText = extractHoverText(result);

    // Update code map with signature info
    if (mapDeps && kwargs.symbol) {
      const map = mapDeps.getMap();
      const symName = String(kwargs.symbol);
      const existing = map.findSymbol(symName);
      if (existing) {
        existing.signature = hoverText.split('\n')[0].slice(0, 200);
      } else {
        map.recordSymbol({
          id: `${rel}::${symName}`,
          name: symName,
          kind: 'Unknown',
          file: rel,
          line: pos.line + 1,
          signature: hoverText.split('\n')[0].slice(0, 200),
          discoveredBy: 'code/hover',
        });
      }
    }

    const lines = [`[HOVER] ${label} at ${rel}:${pos.line + 1}:${pos.character + 1}`, '', hoverText];
    const output = lines.join('\n');
    return output.length > 4000 ? output.slice(0, 4000) + '\n... [truncated]' : output;
  };
}

export function createCodeWorkspaceSymbolsHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const query = String(kwargs.query);
    const maxResults = Number(kwargs.max_results || 30);

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        query,
      )),
      TIMEOUT_MS,
      'executeWorkspaceSymbolProvider',
    );

    if (!result || result.length === 0) {
      return `[INFO] No workspace symbols matching "${query}". The language server may not be active, or try a different query.`;
    }

    const capped = result.slice(0, maxResults);
    const lines = [`[WORKSPACE SYMBOLS] "${query}" — ${result.length} match(es)`, ''];

    for (const sym of capped) {
      const file = relPath(sym.location.uri.fsPath);
      const line = sym.location.range.start.line + 1;
      const container = sym.containerName ? ` in ${sym.containerName}` : '';
      lines.push(`  ${sym.name} (${symbolKindName(sym.kind)})${container} — ${file}:${line}`);

      // Record to code map
      if (mapDeps) {
        const map = mapDeps.getMap();
        map.touchFile(file);
        map.recordSymbol({
          id: `${file}::${sym.name}`,
          name: sym.name,
          kind: symbolKindName(sym.kind),
          file,
          line,
          discoveredBy: 'code/workspace-symbols',
        });
      }
    }

    if (result.length > maxResults) {
      lines.push('');
      lines.push(`... ${result.length - maxResults} more match(es) omitted (increase max_results to see all)`);
    }

    return lines.join('\n');
  };
}

// ── Composite Explore ─────────────────────────────────────────────────

export function createCodeExploreHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const targetSymbol = kwargs.symbol ? String(kwargs.symbol) : undefined;
    const depth = Math.min(Number(kwargs.depth || 2), 3);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const rel = relPath(doc.uri.fsPath);
    const sections: string[] = [`[EXPLORE] ${rel}${targetSymbol ? ` → ${targetSymbol}` : ''}`, ''];

    // Step 1: Document symbols (always)
    const symbols = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri,
      )),
      TIMEOUT_MS, 'executeDocumentSymbolProvider',
    );

    if (symbols && symbols.length > 0) {
      if (mapDeps) {
        const map = mapDeps.getMap();
        map.recordFile(rel, doc.languageId, symbols.length);
        for (const s of flattenSymbols(symbols, rel)) {
          map.recordSymbol({
            id: s.id, name: s.name, kind: s.kind, file: rel,
            line: s.line, endLine: s.endLine, discoveredBy: 'code/explore',
          });
        }
      }
      sections.push('── Symbols ──');
      for (const sym of symbols) {
        sections.push(...formatSymbol(sym, 1));
      }
      sections.push('');
    } else {
      sections.push('── Symbols ── (none — language server may not be active)');
      sections.push('');
    }

    // Step 2: If a target symbol is specified, do deep exploration
    if (targetSymbol) {
      const pos = await resolvePosition(doc, { symbol: targetSymbol });
      if (typeof pos !== 'string') {
        // Hover / type info
        const hovers = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider', uri, pos,
          )),
          TIMEOUT_MS, 'executeHoverProvider',
        );
        if (hovers && hovers.length > 0) {
          const hoverText = extractHoverText(hovers);
          sections.push(`── Type Info: ${targetSymbol} ──`);
          sections.push(hoverText.length > 1000 ? hoverText.slice(0, 1000) + '...' : hoverText);
          sections.push('');

          if (mapDeps) {
            const map = mapDeps.getMap();
            const existing = map.findSymbol(targetSymbol);
            if (existing) existing.signature = hoverText.split('\n')[0].slice(0, 200);
          }
        }

        // Definition (with context)
        const defs = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeDefinitionProvider', uri, pos,
          )),
          TIMEOUT_MS, 'executeDefinitionProvider',
        );
        if (defs && defs.length > 0) {
          sections.push(`── Definition: ${targetSymbol} ──`);
          for (const loc of defs.slice(0, 3)) {
            const targetRel = relPath(loc.uri.fsPath);
            const targetLine = loc.range.start.line;
            sections.push(`${targetRel}:${targetLine + 1}`);
            const context = await readContext(loc.uri, targetLine, 2, 15);
            if (context) sections.push(context);
            sections.push('');

            if (mapDeps) {
              const map = mapDeps.getMap();
              map.touchFile(targetRel);
              map.recordSymbol({
                id: `${targetRel}::${targetSymbol}`, name: targetSymbol, kind: 'Unknown',
                file: targetRel, line: targetLine + 1, discoveredBy: 'code/explore',
              });
              if (targetRel !== rel) {
                map.recordRelation({
                  from: `${rel}::${targetSymbol}`, to: `${targetRel}::${targetSymbol}`,
                  kind: 'defines', file: targetRel, line: targetLine + 1,
                });
              }
            }
          }
        }

        // Call hierarchy (depth >= 2)
        if (depth >= 2) {
          const callItems = await withTimeout(
            Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
              'vscode.prepareCallHierarchy', uri, pos,
            )),
            TIMEOUT_MS, 'prepareCallHierarchy',
          );

          if (callItems && callItems.length > 0) {
            const item = callItems[0];
            const itemRel = relPath(item.uri.fsPath);

            const incoming = await withTimeout(
              Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                'vscode.provideIncomingCalls', item,
              )),
              TIMEOUT_MS, 'provideIncomingCalls',
            );

            if (incoming && incoming.length > 0) {
              sections.push(`── Incoming Calls (who calls ${targetSymbol}) ──`);
              for (const call of incoming.slice(0, 15)) {
                const callerRel = relPath(call.from.uri.fsPath);
                sections.push(`  <- ${call.from.name} (${symbolKindName(call.from.kind)}) at ${callerRel}:${call.from.range.start.line + 1}`);
                if (mapDeps) {
                  mapDeps.getMap().touchFile(callerRel);
                  mapDeps.getMap().recordRelation({
                    from: `${callerRel}::${call.from.name}`, to: `${itemRel}::${item.name}`,
                    kind: 'calls', file: callerRel, line: call.from.range.start.line + 1,
                  });
                }
              }
              if (incoming.length > 15) sections.push(`  ... and ${incoming.length - 15} more`);
              sections.push('');
            }

            const outgoing = await withTimeout(
              Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
                'vscode.provideOutgoingCalls', item,
              )),
              TIMEOUT_MS, 'provideOutgoingCalls',
            );

            if (outgoing && outgoing.length > 0) {
              sections.push(`── Outgoing Calls (what ${targetSymbol} calls) ──`);
              for (const call of outgoing.slice(0, 15)) {
                const calleeRel = relPath(call.to.uri.fsPath);
                sections.push(`  -> ${call.to.name} (${symbolKindName(call.to.kind)}) at ${calleeRel}:${call.to.range.start.line + 1}`);
                if (mapDeps) {
                  mapDeps.getMap().touchFile(calleeRel);
                  mapDeps.getMap().recordRelation({
                    from: `${itemRel}::${item.name}`, to: `${calleeRel}::${call.to.name}`,
                    kind: 'calls', file: itemRel, line: item.range.start.line + 1,
                  });
                }
              }
              if (outgoing.length > 15) sections.push(`  ... and ${outgoing.length - 15} more`);
              sections.push('');
            }
          }
        }

        // References (depth >= 3)
        if (depth >= 3) {
          const refs = await withTimeout(
            Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
              'vscode.executeReferenceProvider', uri, pos,
            )),
            TIMEOUT_MS, 'executeReferenceProvider',
          );

          if (refs && refs.length > 0) {
            sections.push(`── References to ${targetSymbol} (${refs.length}) ──`);
            const byFile = new Map<string, vscode.Location[]>();
            for (const loc of refs) {
              const key = relPath(loc.uri.fsPath);
              if (!byFile.has(key)) byFile.set(key, []);
              byFile.get(key)!.push(loc);
            }
            let count = 0;
            for (const [file, locs] of byFile) {
              if (count >= 20) break;
              sections.push(`  ${file}:`);
              for (const loc of locs) {
                if (count >= 20) break;
                try {
                  const refDoc = await vscode.workspace.openTextDocument(loc.uri);
                  sections.push(`    L${loc.range.start.line + 1}: ${refDoc.lineAt(loc.range.start.line).text.trim()}`);
                } catch {
                  sections.push(`    L${loc.range.start.line + 1}`);
                }
                count++;
              }
            }
            if (refs.length > 20) sections.push(`  ... and ${refs.length - 20} more`);
            sections.push('');
          }
        }
      } else {
        sections.push(`── Symbol "${targetSymbol}" not found in file ──`);
        sections.push('');
      }
    } else if (symbols && symbols.length > 0) {
      // No specific symbol — show hover info for top-level exported symbols
      const topSymbols = flattenSymbols(symbols, rel).filter((s) => !s.container).slice(0, 10);
      if (topSymbols.length > 0) {
        sections.push('── Key Exports (type info) ──');
        for (const sym of topSymbols) {
          const symPos = new vscode.Position(sym.line - 1, 0);
          const hovers = await withTimeout(
            Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
              'vscode.executeHoverProvider', uri, symPos,
            )),
            5000, 'executeHoverProvider',
          );
          if (hovers && hovers.length > 0) {
            const text = extractHoverText(hovers).split('\n')[0].slice(0, 150);
            sections.push(`  ${sym.name} (${sym.kind}): ${text}`);
          } else {
            sections.push(`  ${sym.name} (${sym.kind}) L${sym.line}`);
          }
        }
        sections.push('');
      }
    }

    const output = sections.join('\n');
    return output.length > 8000 ? output.slice(0, 8000) + '\n... [truncated]' : output;
  };
}

// ── Code Actions & Quick Fixes ────────────────────────────────────────

export function createCodeActionsHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    let range: vscode.Range;
    if (kwargs.line) {
      const line = Number(kwargs.line) - 1;
      const endLine = kwargs.end_line ? Number(kwargs.end_line) - 1 : line;
      range = new vscode.Range(line, 0, endLine, doc.lineAt(endLine).text.length);
    } else {
      range = new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
    }

    const kindFilter = kwargs.kind ? String(kwargs.kind) : undefined;

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        range,
        kindFilter,
      )),
      TIMEOUT_MS,
      'executeCodeActionProvider',
    );

    if (!result || result.length === 0) {
      return `[INFO] No code actions available at ${relPath(doc.uri.fsPath)}:${kwargs.line || 'all'}. No fixes or refactorings suggested.`;
    }

    const rel = relPath(doc.uri.fsPath);
    const lines = [`[CODE ACTIONS] ${rel} — ${result.length} action(s)`, ''];

    for (let i = 0; i < result.length && i < 30; i++) {
      const action = result[i];
      const kind = action.kind ? ` [${action.kind.value}]` : '';
      const preferred = action.isPreferred ? ' *preferred*' : '';
      const disabled = action.disabled ? ` (disabled: ${action.disabled.reason})` : '';
      lines.push(`  ${i + 1}. ${action.title}${kind}${preferred}${disabled}`);
    }

    if (result.length > 30) {
      lines.push(`  ... and ${result.length - 30} more`);
    }

    lines.push('');
    lines.push('Use code/fix with the action title to apply a fix.');

    return lines.join('\n');
  };
}

export function createCodeFixHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const title = String(kwargs.title);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    let range: vscode.Range;
    if (kwargs.line) {
      const line = Number(kwargs.line) - 1;
      const endLine = kwargs.end_line ? Number(kwargs.end_line) - 1 : line;
      range = new vscode.Range(line, 0, endLine, doc.lineAt(endLine).text.length);
    } else {
      range = new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
    }

    const actions = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        range,
      )),
      TIMEOUT_MS,
      'executeCodeActionProvider',
    );

    if (!actions || actions.length === 0) {
      return `[ERROR] No code actions found at ${relPath(doc.uri.fsPath)}.`;
    }

    const titleLower = title.toLowerCase();
    const match = actions.find((a) => a.title.toLowerCase() === titleLower)
      || actions.find((a) => a.title.toLowerCase().includes(titleLower));

    if (!match) {
      const available = actions.slice(0, 10).map((a) => `  - ${a.title}`).join('\n');
      return `[ERROR] No action matching "${title}". Available:\n${available}`;
    }

    let applied = false;

    if (match.edit) {
      applied = await vscode.workspace.applyEdit(match.edit);
    }

    if (match.command) {
      await vscode.commands.executeCommand(
        match.command.command,
        ...(match.command.arguments || []),
      );
      applied = true;
    }

    if (!applied) {
      return `[ERROR] Action "${match.title}" has no edit or command to apply.`;
    }

    return `[OK] Applied: "${match.title}"`;
  };
}

// ── Rename Symbol ─────────────────────────────────────────────────────

export function createCodeRenameHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const newName = String(kwargs.new_name);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const edit = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider',
        uri,
        pos,
        newName,
      )),
      TIMEOUT_MS,
      'executeDocumentRenameProvider',
    );

    if (!edit) {
      return `[ERROR] Rename failed — no language server response. Ensure the cursor is on an identifier.`;
    }

    const entries = edit.entries();
    if (entries.length === 0) {
      return `[ERROR] Rename produced no edits. The symbol may not be renameable.`;
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return `[ERROR] Failed to apply rename edits.`;
    }

    let totalEdits = 0;
    const fileList: string[] = [];
    for (const [entryUri, edits] of entries) {
      totalEdits += edits.length;
      fileList.push(`  ${relPath(entryUri.fsPath)} (${edits.length} edit(s))`);
    }

    return `[OK] Renamed to "${newName}" — ${totalEdits} edit(s) across ${entries.length} file(s):\n${fileList.join('\n')}`;
  };
}

// ── Format Document ───────────────────────────────────────────────────

export function createCodeFormatHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const options: vscode.FormattingOptions = {
      tabSize: Number(kwargs.tab_size || 2),
      insertSpaces: kwargs.insert_spaces !== false && kwargs.insert_spaces !== 'false',
    };

    let edits: vscode.TextEdit[] | null;

    if (kwargs.line) {
      const startLine = Number(kwargs.line) - 1;
      const endLine = Number(kwargs.end_line || kwargs.line) - 1;
      const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
      edits = await withTimeout(
        Promise.resolve(vscode.commands.executeCommand<vscode.TextEdit[]>(
          'vscode.executeFormatRangeProvider',
          uri,
          range,
          options,
        )),
        TIMEOUT_MS,
        'executeFormatRangeProvider',
      );
    } else {
      edits = await withTimeout(
        Promise.resolve(vscode.commands.executeCommand<vscode.TextEdit[]>(
          'vscode.executeFormatDocumentProvider',
          uri,
          options,
        )),
        TIMEOUT_MS,
        'executeFormatDocumentProvider',
      );
    }

    if (!edits || edits.length === 0) {
      return `[INFO] No formatting changes needed for ${relPath(doc.uri.fsPath)}, or no formatter is available.`;
    }

    const wsEdit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      wsEdit.replace(uri, e.range, e.newText);
    }
    const applied = await vscode.workspace.applyEdit(wsEdit);

    if (!applied) {
      return `[ERROR] Failed to apply formatting edits.`;
    }

    return `[OK] Formatted ${relPath(doc.uri.fsPath)} — ${edits.length} edit(s) applied.`;
  };
}

// ── Call Hierarchy ────────────────────────────────────────────────────

export function createCodeCallHierarchyHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const direction = String(kwargs.direction || 'both');

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const items = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'prepareCallHierarchy',
    );

    if (!items || items.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : '';
      return `[INFO] No call hierarchy${sym} at ${relPath(doc.uri.fsPath)}. Ensure the cursor is on a function or method.`;
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : items[0].name;
    const lines: string[] = [`[CALL HIERARCHY] ${label}`, ''];

    for (const item of items) {
      const itemRel = relPath(item.uri.fsPath);
      lines.push(`${item.name} (${symbolKindName(item.kind)}) at ${itemRel}:${item.range.start.line + 1}`);

      if (direction === 'incoming' || direction === 'both') {
        const incoming = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
            'vscode.provideIncomingCalls',
            item,
          )),
          TIMEOUT_MS,
          'provideIncomingCalls',
        );

        if (incoming && incoming.length > 0) {
          lines.push('');
          lines.push('  Incoming calls (who calls this):');
          for (const call of incoming.slice(0, 20)) {
            const callerRel = relPath(call.from.uri.fsPath);
            const fromRanges = call.fromRanges.map((r) => `L${r.start.line + 1}`).join(', ');
            lines.push(`    <- ${call.from.name} (${symbolKindName(call.from.kind)}) at ${callerRel}:${call.from.range.start.line + 1} [${fromRanges}]`);

            if (mapDeps) {
              const map = mapDeps.getMap();
              map.touchFile(callerRel);
              map.recordRelation({
                from: `${callerRel}::${call.from.name}`,
                to: `${itemRel}::${item.name}`,
                kind: 'calls',
                file: callerRel,
                line: call.from.range.start.line + 1,
              });
            }
          }
          if (incoming.length > 20) lines.push(`    ... and ${incoming.length - 20} more`);
        }
      }

      if (direction === 'outgoing' || direction === 'both') {
        const outgoing = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
            'vscode.provideOutgoingCalls',
            item,
          )),
          TIMEOUT_MS,
          'provideOutgoingCalls',
        );

        if (outgoing && outgoing.length > 0) {
          lines.push('');
          lines.push('  Outgoing calls (what this calls):');
          for (const call of outgoing.slice(0, 20)) {
            const calleeRel = relPath(call.to.uri.fsPath);
            const fromRanges = call.fromRanges.map((r) => `L${r.start.line + 1}`).join(', ');
            lines.push(`    -> ${call.to.name} (${symbolKindName(call.to.kind)}) at ${calleeRel}:${call.to.range.start.line + 1} [${fromRanges}]`);

            if (mapDeps) {
              const map = mapDeps.getMap();
              map.touchFile(calleeRel);
              map.recordRelation({
                from: `${itemRel}::${item.name}`,
                to: `${calleeRel}::${call.to.name}`,
                kind: 'calls',
                file: itemRel,
                line: item.range.start.line + 1,
              });
            }
          }
          if (outgoing.length > 20) lines.push(`    ... and ${outgoing.length - 20} more`);
        }
      }
    }

    return lines.join('\n');
  };
}

// ── Type Hierarchy ────────────────────────────────────────────────────

export function createCodeTypeHierarchyHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const direction = String(kwargs.direction || 'both');

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const items = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
        'vscode.prepareTypeHierarchy',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'prepareTypeHierarchy',
    );

    if (!items || items.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : '';
      return `[INFO] No type hierarchy${sym} at ${relPath(doc.uri.fsPath)}. Ensure the cursor is on a class or interface.`;
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : items[0].name;
    const lines: string[] = [`[TYPE HIERARCHY] ${label}`, ''];

    for (const item of items) {
      const itemRel = relPath(item.uri.fsPath);
      lines.push(`${item.name} (${symbolKindName(item.kind)}) at ${itemRel}:${item.range.start.line + 1}`);

      if (direction === 'supertypes' || direction === 'both') {
        const supertypes = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
            'vscode.provideSupertypes',
            item,
          )),
          TIMEOUT_MS,
          'provideSupertypes',
        );

        if (supertypes && supertypes.length > 0) {
          lines.push('');
          lines.push('  Supertypes (extends/implements):');
          for (const st of supertypes.slice(0, 15)) {
            const stRel = relPath(st.uri.fsPath);
            lines.push(`    ^ ${st.name} (${symbolKindName(st.kind)}) at ${stRel}:${st.range.start.line + 1}`);

            if (mapDeps) {
              const map = mapDeps.getMap();
              map.touchFile(stRel);
              map.recordRelation({
                from: `${itemRel}::${item.name}`,
                to: `${stRel}::${st.name}`,
                kind: 'extends',
                file: itemRel,
                line: item.range.start.line + 1,
              });
            }
          }
        }
      }

      if (direction === 'subtypes' || direction === 'both') {
        const subtypes = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
            'vscode.provideSubtypes',
            item,
          )),
          TIMEOUT_MS,
          'provideSubtypes',
        );

        if (subtypes && subtypes.length > 0) {
          lines.push('');
          lines.push('  Subtypes (implemented by):');
          for (const st of subtypes.slice(0, 15)) {
            const stRel = relPath(st.uri.fsPath);
            lines.push(`    v ${st.name} (${symbolKindName(st.kind)}) at ${stRel}:${st.range.start.line + 1}`);

            if (mapDeps) {
              const map = mapDeps.getMap();
              map.touchFile(stRel);
              map.recordRelation({
                from: `${stRel}::${st.name}`,
                to: `${itemRel}::${item.name}`,
                kind: 'implements',
                file: stRel,
                line: st.range.start.line + 1,
              });
            }
          }
        }
      }
    }

    return lines.join('\n');
  };
}

// ── Signature Help ────────────────────────────────────────────────────

export function createCodeSignatureHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const triggerChar = kwargs.trigger_character ? String(kwargs.trigger_character) : undefined;

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.SignatureHelp>(
        'vscode.executeSignatureHelpProvider',
        uri,
        pos,
        ...(triggerChar ? [triggerChar] : []),
      )),
      TIMEOUT_MS,
      'executeSignatureHelpProvider',
    );

    if (!result || result.signatures.length === 0) {
      return `[INFO] No signature help at ${relPath(doc.uri.fsPath)}:${pos.line + 1}:${pos.character + 1}. Place the cursor inside a function call's parentheses.`;
    }

    const lines: string[] = [`[SIGNATURE] at ${relPath(doc.uri.fsPath)}:${pos.line + 1}`, ''];

    for (const sig of result.signatures) {
      lines.push(`  ${sig.label}`);
      if (sig.documentation) {
        const docText = typeof sig.documentation === 'string'
          ? sig.documentation
          : sig.documentation.value;
        if (docText) lines.push(`  ${docText}`);
      }
      if (sig.parameters.length > 0) {
        lines.push('  Parameters:');
        for (const param of sig.parameters) {
          const paramLabel = typeof param.label === 'string'
            ? param.label
            : sig.label.slice(param.label[0], param.label[1]);
          const paramDoc = param.documentation
            ? typeof param.documentation === 'string'
              ? param.documentation
              : param.documentation.value
            : '';
          lines.push(`    ${paramLabel}${paramDoc ? ' — ' + paramDoc : ''}`);
        }
      }
      lines.push('');
    }

    const active = result.activeSignature;
    const activeParam = result.activeParameter;
    if (active !== undefined && result.signatures[active]) {
      const activeSig = result.signatures[active];
      if (activeParam !== undefined && activeSig.parameters[activeParam]) {
        const p = activeSig.parameters[activeParam];
        const pLabel = typeof p.label === 'string' ? p.label : activeSig.label.slice(p.label[0], p.label[1]);
        lines.push(`Active parameter: ${pLabel} (index ${activeParam})`);
      }
    }

    return lines.join('\n');
  };
}

// ── Completions ───────────────────────────────────────────────────────

export function createCodeCompletionsHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const maxResults = Number(kwargs.max_results || 20);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const triggerChar = kwargs.trigger_character ? String(kwargs.trigger_character) : undefined;

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        uri,
        pos,
        ...(triggerChar ? [triggerChar] : []),
      )),
      TIMEOUT_MS,
      'executeCompletionItemProvider',
    );

    if (!result || result.items.length === 0) {
      return `[INFO] No completions at ${relPath(doc.uri.fsPath)}:${pos.line + 1}:${pos.character + 1}.`;
    }

    const kindNames: Record<number, string> = {
      [vscode.CompletionItemKind.Text]: 'Text',
      [vscode.CompletionItemKind.Method]: 'Method',
      [vscode.CompletionItemKind.Function]: 'Function',
      [vscode.CompletionItemKind.Constructor]: 'Constructor',
      [vscode.CompletionItemKind.Field]: 'Field',
      [vscode.CompletionItemKind.Variable]: 'Variable',
      [vscode.CompletionItemKind.Class]: 'Class',
      [vscode.CompletionItemKind.Interface]: 'Interface',
      [vscode.CompletionItemKind.Module]: 'Module',
      [vscode.CompletionItemKind.Property]: 'Property',
      [vscode.CompletionItemKind.Unit]: 'Unit',
      [vscode.CompletionItemKind.Value]: 'Value',
      [vscode.CompletionItemKind.Enum]: 'Enum',
      [vscode.CompletionItemKind.Keyword]: 'Keyword',
      [vscode.CompletionItemKind.Snippet]: 'Snippet',
      [vscode.CompletionItemKind.Color]: 'Color',
      [vscode.CompletionItemKind.File]: 'File',
      [vscode.CompletionItemKind.Reference]: 'Reference',
      [vscode.CompletionItemKind.Folder]: 'Folder',
      [vscode.CompletionItemKind.EnumMember]: 'EnumMember',
      [vscode.CompletionItemKind.Constant]: 'Constant',
      [vscode.CompletionItemKind.Struct]: 'Struct',
      [vscode.CompletionItemKind.Event]: 'Event',
      [vscode.CompletionItemKind.Operator]: 'Operator',
      [vscode.CompletionItemKind.TypeParameter]: 'TypeParam',
    };

    const items = result.items.slice(0, maxResults);
    const lines = [`[COMPLETIONS] ${relPath(doc.uri.fsPath)}:${pos.line + 1}:${pos.character + 1} — ${result.items.length} item(s)`, ''];

    for (const item of items) {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      const kind = item.kind !== undefined ? kindNames[item.kind] || 'Unknown' : '';
      const detail = item.detail ? ` — ${item.detail}` : '';
      lines.push(`  ${label} (${kind})${detail}`);
    }

    if (result.items.length > maxResults) {
      lines.push(`  ... and ${result.items.length - maxResults} more`);
    }

    return lines.join('\n');
  };
}

// ── Inlay Hints ───────────────────────────────────────────────────────

export function createCodeInlayHintsHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const startLine = kwargs.line ? Number(kwargs.line) - 1 : 0;
    const endLine = kwargs.end_line ? Number(kwargs.end_line) - 1 : doc.lineCount - 1;
    const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        uri,
        range,
      )),
      TIMEOUT_MS,
      'executeInlayHintProvider',
    );

    if (!result || result.length === 0) {
      return `[INFO] No inlay hints for ${relPath(doc.uri.fsPath)}${kwargs.line ? `:${kwargs.line}` : ''}. The language server may not support inlay hints.`;
    }

    const rel = relPath(doc.uri.fsPath);
    const lines = [`[INLAY HINTS] ${rel} — ${result.length} hint(s)`, ''];

    for (const hint of result.slice(0, 50)) {
      const hintLabel = typeof hint.label === 'string'
        ? hint.label
        : hint.label.map((p) => typeof p === 'string' ? p : p.value).join('');
      const kindLabel = hint.kind === vscode.InlayHintKind.Type ? 'type'
        : hint.kind === vscode.InlayHintKind.Parameter ? 'param'
        : '';
      const lineText = doc.lineAt(hint.position.line).text.trim();
      lines.push(`  L${hint.position.line + 1}:${hint.position.character + 1} [${kindLabel}] ${hintLabel}`);
      lines.push(`    ${lineText}`);
    }

    if (result.length > 50) {
      lines.push(`  ... and ${result.length - 50} more`);
    }

    return lines.join('\n');
  };
}
