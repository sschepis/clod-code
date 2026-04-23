import * as vscode from 'vscode';
import { execSync } from 'child_process';
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

// ── Type Definition ──────────────────────────────────────────────────

export function createCodeTypeDefinitionHandler(mapDeps?: CodeMapDeps) {
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
        'vscode.executeTypeDefinitionProvider',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'executeTypeDefinitionProvider',
    );

    if (!result || result.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : ` at ${kwargs.line}:${kwargs.column || 1}`;
      return NO_LANG_SERVER(`code/type-definition${sym}`, relPath(doc.uri.fsPath));
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const rel = relPath(doc.uri.fsPath);
    const lines: string[] = [`[TYPE DEFINITION] ${label}`, ''];

    for (const loc of result.slice(0, 5)) {
      const targetRel = relPath(loc.uri.fsPath);
      const targetLine = loc.range.start.line;
      lines.push(`Type defined at: ${targetRel}:${targetLine + 1}:${loc.range.start.character + 1}`);

      const context = await readContext(loc.uri, targetLine, 1, MAX_CONTEXT_LINES);
      if (context) {
        lines.push('');
        lines.push(context);
        lines.push('');
      }

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
          discoveredBy: 'code/type-definition',
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
      lines.push(`... and ${result.length - 5} more type definition(s)`);
    }

    return lines.join('\n');
  };
}

// ── Implementation ───────────────────────────────────────────────────

export function createCodeImplementationHandler(mapDeps?: CodeMapDeps) {
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
        'vscode.executeImplementationProvider',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'executeImplementationProvider',
    );

    if (!result || result.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : ` at ${kwargs.line}:${kwargs.column || 1}`;
      return NO_LANG_SERVER(`code/implementation${sym}`, relPath(doc.uri.fsPath));
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const rel = relPath(doc.uri.fsPath);
    const lines: string[] = [`[IMPLEMENTATIONS] ${label} — ${result.length} implementation(s)`, ''];

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

        if (mapDeps) {
          const map = mapDeps.getMap();
          const symName = kwargs.symbol ? String(kwargs.symbol) : label;
          map.touchFile(file);
          map.recordRelation({
            from: `${file}::${symName}`,
            to: `${rel}::${symName}`,
            kind: 'implements',
            file,
            line: lineNum + 1,
          });
        }
      }
    }

    if (result.length > maxResults) {
      lines.push('');
      lines.push(`... ${result.length - maxResults} more implementation(s) omitted (increase max_results to see all)`);
    }

    return lines.join('\n');
  };
}

// ── Declaration ──────────────────────────────────────────────────────

export function createCodeDeclarationHandler(mapDeps?: CodeMapDeps) {
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
        'vscode.executeDeclarationProvider',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'executeDeclarationProvider',
    );

    if (!result || result.length === 0) {
      const sym = kwargs.symbol ? ` for "${kwargs.symbol}"` : ` at ${kwargs.line}:${kwargs.column || 1}`;
      return NO_LANG_SERVER(`code/declaration${sym}`, relPath(doc.uri.fsPath));
    }

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const rel = relPath(doc.uri.fsPath);
    const lines: string[] = [`[DECLARATION] ${label}`, ''];

    for (const loc of result.slice(0, 5)) {
      const targetRel = relPath(loc.uri.fsPath);
      const targetLine = loc.range.start.line;
      lines.push(`Declared at: ${targetRel}:${targetLine + 1}:${loc.range.start.character + 1}`);

      const context = await readContext(loc.uri, targetLine, 1, MAX_CONTEXT_LINES);
      if (context) {
        lines.push('');
        lines.push(context);
        lines.push('');
      }

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
          discoveredBy: 'code/declaration',
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
      lines.push(`... and ${result.length - 5} more declaration(s)`);
    }

    return lines.join('\n');
  };
}

// ── Folding Ranges ───────────────────────────────────────────────────

function foldingKindName(kind?: vscode.FoldingRangeKind): string {
  if (kind === vscode.FoldingRangeKind.Comment) return 'Comment';
  if (kind === vscode.FoldingRangeKind.Imports) return 'Imports';
  if (kind === vscode.FoldingRangeKind.Region) return 'Region';
  return 'Code';
}

export function createCodeFoldingHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.FoldingRange[]>(
        'vscode.executeFoldingRangeProvider',
        uri,
      )),
      TIMEOUT_MS,
      'executeFoldingRangeProvider',
    );

    if (!result || result.length === 0) {
      return NO_LANG_SERVER('code/folding', relPath(doc.uri.fsPath));
    }

    const rel = relPath(doc.uri.fsPath);
    const lines = [`[FOLDING] ${rel} — ${result.length} foldable region(s)`, ''];

    for (const range of result.slice(0, 80)) {
      const startLine = range.start + 1;
      const endLine = range.end + 1;
      const kind = foldingKindName(range.kind);
      if (range.start >= doc.lineCount) continue;
      const lineText = doc.lineAt(range.start).text.trim();
      lines.push(`  L${startLine}-L${endLine} [${kind}] ${lineText}`);
    }

    if (result.length > 80) {
      lines.push(`  ... and ${result.length - 80} more`);
    }

    return lines.join('\n');
  };
}

// ── Selection Ranges ─────────────────────────────────────────────────

export function createCodeSelectionRangesHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const line = Number(kwargs.line) - 1;
    const col = Number(kwargs.column || 1) - 1;
    if (line < 0 || line >= doc.lineCount) {
      return `[ERROR] Line ${kwargs.line} is out of range (file has ${doc.lineCount} lines).`;
    }
    const pos = new vscode.Position(line, col);

    const result = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.SelectionRange[]>(
        'vscode.executeSelectionRangeProvider',
        uri,
        [pos],
      )),
      TIMEOUT_MS,
      'executeSelectionRangeProvider',
    );

    if (!result || result.length === 0) {
      return `[INFO] No selection ranges at ${relPath(doc.uri.fsPath)}:${kwargs.line}:${kwargs.column || 1}. The language server may not support selection ranges.`;
    }

    const rel = relPath(doc.uri.fsPath);
    const lines: string[] = [`[SELECTION RANGES] ${rel}:${line + 1}:${col + 1}`, ''];

    let current: vscode.SelectionRange | undefined = result[0];
    let level = 1;
    while (current && level <= 10) {
      const r = current.range;
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const span = endLine - startLine + 1;
      const lineText = r.start.line < doc.lineCount ? doc.lineAt(r.start.line).text.trim() : '';
      const preview = lineText.length > 100 ? lineText.slice(0, 100) + '...' : lineText;
      lines.push(`  Level ${level}: L${startLine}:${r.start.character + 1}-L${endLine}:${r.end.character + 1} (${span} line${span > 1 ? 's' : ''})`);
      lines.push(`    ${preview}`);
      current = current.parent;
      level++;
    }

    if (current) {
      lines.push(`  ... deeper levels omitted`);
    }

    return lines.join('\n');
  };
}

// ── Impact Analysis (composite) ──────────────────────────────────────

export function createCodeImpactHandler(mapDeps?: CodeMapDeps) {
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

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const rel = relPath(doc.uri.fsPath);
    const sections: string[] = [`[IMPACT] ${label} — blast radius analysis`, ''];

    // Step 1: Find all references
    const refs = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        pos,
      )),
      TIMEOUT_MS,
      'executeReferenceProvider',
    );

    if (!refs || refs.length === 0) {
      sections.push('No references found — symbol may be unused or language server is not active.');
      return sections.join('\n');
    }

    // Group references by file
    const byFile = new Map<string, vscode.Location[]>();
    for (const loc of refs) {
      const key = relPath(loc.uri.fsPath);
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(loc);
    }

    const affectedFiles = [...byFile.keys()];

    sections.push(`── References: ${refs.length} across ${affectedFiles.length} file(s) ──`);
    for (const [file, locs] of byFile) {
      sections.push(`  ${file} (${locs.length} ref${locs.length > 1 ? 's' : ''})`);
      if (mapDeps) {
        const map = mapDeps.getMap();
        map.touchFile(file);
        for (const loc of locs) {
          map.recordRelation({
            from: `${file}::${label}`,
            to: `${rel}::${label}`,
            kind: 'references',
            file,
            line: loc.range.start.line + 1,
          });
        }
      }
    }
    sections.push('');

    // Step 2: Diagnostics in affected files
    const allDiagnostics = vscode.languages.getDiagnostics();
    const affectedDiags: string[] = [];
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    for (const [diagUri, diagnostics] of allDiagnostics) {
      const diagRel = rootPath ? diagUri.fsPath.replace(rootPath + '/', '') : diagUri.fsPath;
      if (!affectedFiles.includes(diagRel)) continue;
      for (const d of diagnostics) {
        if (d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning) {
          const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
          affectedDiags.push(`  ${diagRel}:${d.range.start.line + 1} [${sev}] ${d.message}`);
        }
      }
    }

    if (affectedDiags.length > 0) {
      sections.push(`── Diagnostics in affected files: ${affectedDiags.length} ──`);
      sections.push(...affectedDiags.slice(0, 30));
      if (affectedDiags.length > 30) sections.push(`  ... and ${affectedDiags.length - 30} more`);
    } else {
      sections.push('── Diagnostics in affected files: none ──');
    }
    sections.push('');

    // Step 3: Test coverage
    const testFiles = await withTimeout(
      Promise.resolve(vscode.workspace.findFiles(
        '{**/*.test.*,**/*.spec.*,**/__tests__/**,**/test/**}',
        '**/node_modules/**',
        500,
      )),
      TIMEOUT_MS,
      'findFiles (tests)',
    );

    const testFileSet = new Set<string>();
    if (testFiles) {
      for (const tf of testFiles) {
        testFileSet.add(relPath(tf.fsPath));
      }
    }

    const filesWithTests: string[] = [];
    const filesWithoutTests: string[] = [];

    for (const file of affectedFiles) {
      const baseName = file.replace(/\.\w+$/, '');
      const hasTest = [...testFileSet].some((t) =>
        t.includes(baseName) || t.replace(/\.(test|spec)/, '').replace(/\.\w+$/, '').endsWith(baseName.replace(/.*\//, '')),
      );
      if (hasTest) {
        filesWithTests.push(file);
      } else {
        filesWithoutTests.push(file);
      }
    }

    sections.push('── Test coverage ──');
    if (filesWithTests.length > 0) {
      sections.push('  Files with related tests:');
      for (const f of filesWithTests) sections.push(`    + ${f}`);
    }
    if (filesWithoutTests.length > 0) {
      sections.push('  Files WITHOUT test coverage:');
      for (const f of filesWithoutTests) sections.push(`    - ${f}`);
    }
    if (filesWithTests.length === 0 && filesWithoutTests.length === 0) {
      sections.push('  No test files found in workspace.');
    }

    return sections.join('\n');
  };
}

// ── Dataflow Tracing (composite) ─────────────────────────────────────

const ASSIGNMENT_RE = /(?:const|let|var|val|auto)\s+(\w+)\s*[:=]|(\w+)\s*=/;

export function createCodeDataflowHandler(mapDeps?: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);
    const maxDepth = Math.min(Number(kwargs.depth || 2), 3);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const pos = await resolvePosition(doc, kwargs);
    if (typeof pos === 'string') return pos;

    const label = kwargs.symbol ? String(kwargs.symbol) : `L${(pos.line + 1)}:${(pos.character + 1)}`;
    const rel = relPath(doc.uri.fsPath);
    const sections: string[] = [`[DATAFLOW] ${label} — depth ${maxDepth}`, ''];

    // Step 1: Find definition (origin)
    const defs = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', uri, pos,
      )),
      TIMEOUT_MS, 'executeDefinitionProvider',
    );

    if (defs && defs.length > 0) {
      const defLoc = defs[0];
      const defRel = relPath(defLoc.uri.fsPath);
      const defLine = defLoc.range.start.line;
      const defText = await readContext(defLoc.uri, defLine, 0, 0);
      sections.push('── Origin ──');
      sections.push(`  ${label} defined at ${defRel}:${defLine + 1}`);
      if (defText) sections.push(`  ${defText.trim()}`);
      sections.push('');
    }

    // Step 2: Trace flow through levels
    interface TraceTarget { uri: vscode.Uri; pos: vscode.Position; name: string }
    const queue: Array<{ targets: TraceTarget[]; level: number }> = [
      { targets: [{ uri, pos, name: label }], level: 1 },
    ];
    const visited = new Set<string>();
    visited.add(`${rel}:${pos.line}:${pos.character}`);

    const MAX_VISITED = 500;
    while (queue.length > 0) {
      const { targets, level } = queue.shift()!;
      if (level > maxDepth) break;
      if (visited.size > MAX_VISITED) {
        sections.push('[WARNING] Dataflow trace too large; stopping analysis.');
        break;
      }

      for (const target of targets) {
        const refs = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider', target.uri, target.pos,
          )),
          TIMEOUT_MS, 'executeReferenceProvider',
        );

        if (!refs || refs.length === 0) continue;

        sections.push(`── Flow Level ${level}: ${target.name} (${refs.length} reference${refs.length > 1 ? 's' : ''}) ──`);
        const nextTargets: TraceTarget[] = [];

        for (const ref of refs.slice(0, 20)) {
          const refRel = relPath(ref.uri.fsPath);
          const refLine = ref.range.start.line;
          const visitKey = `${refRel}:${refLine}:${ref.range.start.character}`;
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);

          try {
            const refDoc = await vscode.workspace.openTextDocument(ref.uri);
            const lineText = refDoc.lineAt(refLine).text;
            const match = ASSIGNMENT_RE.exec(lineText);
            const assignedTo = match ? (match[1] || match[2]) : undefined;

            if (assignedTo && assignedTo !== target.name) {
              sections.push(`  ${refRel}:${refLine + 1} — assigned to ${assignedTo}`);
              sections.push(`    ${lineText.trim()}`);
              if (level < maxDepth) {
                const assignPos = new vscode.Position(refLine, lineText.indexOf(assignedTo));
                nextTargets.push({ uri: ref.uri, pos: assignPos, name: assignedTo });
              }
            } else {
              sections.push(`  ${refRel}:${refLine + 1} — read`);
              sections.push(`    ${lineText.trim()}`);
            }
          } catch {
            sections.push(`  ${refRel}:${refLine + 1}`);
          }

          if (mapDeps) {
            mapDeps.getMap().touchFile(refRel);
            mapDeps.getMap().recordRelation({
              from: `${refRel}::${target.name}`,
              to: `${rel}::${label}`,
              kind: 'references',
              file: refRel,
              line: refLine + 1,
            });
          }
        }

        if (refs.length > 20) {
          sections.push(`  ... and ${refs.length - 20} more reference(s)`);
        }
        sections.push('');

        if (nextTargets.length > 0 && level < maxDepth) {
          queue.push({ targets: nextTargets, level: level + 1 });
        }
      }
    }

    const output = sections.join('\n');
    return output.length > 8000 ? output.slice(0, 8000) + '\n... [truncated]' : output;
  };
}

// ── Semantic Diff (composite) ────────────────────────────────────────

export function createCodeSemanticDiffHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path);
    const uri = resolveUri(filePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return `[ERROR] File not found: ${filePath}. Check the path — use search/glob to find files by name pattern, or workspace/info to see the workspace root.`;
    }

    const rel = relPath(doc.uri.fsPath);

    // Get current symbols
    const currentSymbols = await withTimeout(
      Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri,
      )),
      TIMEOUT_MS, 'executeDocumentSymbolProvider',
    );

    if (!currentSymbols || currentSymbols.length === 0) {
      return NO_LANG_SERVER('code/semantic-diff', rel);
    }

    const currentFlat = flattenSymbols(currentSymbols, rel);

    // Get old file content from git HEAD
    let oldContent: string;
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    try {
      const escapedRel = rel.replace(/'/g, "'\\''");
      oldContent = execSync(`git show 'HEAD:${escapedRel}'`, { cwd: rootPath, encoding: 'utf8', timeout: 5000 });
    } catch {
      return `[INFO] Cannot get HEAD version of ${rel}. File may be new (untracked) or not in a git repository.`;
    }

    // Get old symbols via untitled document
    let oldFlat: Array<{ id: string; name: string; kind: string; line: number; endLine: number; container?: string }> = [];
    try {
      const oldDoc = await vscode.workspace.openTextDocument({ content: oldContent, language: doc.languageId });
      const oldSymbols = await withTimeout(
        Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider', oldDoc.uri,
        )),
        TIMEOUT_MS, 'executeDocumentSymbolProvider (old)',
      );
      if (oldSymbols) {
        oldFlat = flattenSymbols(oldSymbols, rel);
      }
    } catch {
      // Fall through — oldFlat stays empty, everything will show as "added"
    }

    // Compare symbol lists
    const oldByKey = new Map(oldFlat.map((s) => [`${s.name}:${s.kind}`, s]));
    const currentByKey = new Map(currentFlat.map((s) => [`${s.name}:${s.kind}`, s]));

    const added: typeof currentFlat = [];
    const removed: typeof oldFlat = [];
    const modified: Array<{ name: string; kind: string; oldLines: number; newLines: number; line: number; endLine: number }> = [];
    let unchanged = 0;

    for (const [key, sym] of currentByKey) {
      const old = oldByKey.get(key);
      if (!old) {
        added.push(sym);
      } else {
        const oldSize = (old.endLine || old.line) - old.line + 1;
        const newSize = (sym.endLine || sym.line) - sym.line + 1;
        if (oldSize !== newSize) {
          modified.push({ name: sym.name, kind: sym.kind, oldLines: oldSize, newLines: newSize, line: sym.line, endLine: sym.endLine });
        } else {
          unchanged++;
        }
      }
    }

    for (const [key, sym] of oldByKey) {
      if (!currentByKey.has(key)) {
        removed.push(sym);
      }
    }

    const lines: string[] = [`[SEMANTIC DIFF] ${rel}`, ''];

    if (added.length > 0) {
      lines.push('── Added symbols ──');
      for (const s of added) {
        lines.push(`  + ${s.name} (${s.kind}) L${s.line}-L${s.endLine}`);
      }
      lines.push('');
    }

    if (removed.length > 0) {
      lines.push('── Removed symbols ──');
      for (const s of removed) {
        lines.push(`  - ${s.name} (${s.kind}) was L${s.line}-L${s.endLine}`);
      }
      lines.push('');
    }

    if (modified.length > 0) {
      lines.push('── Modified symbols (size changed) ──');
      for (const s of modified) {
        lines.push(`  ~ ${s.name} (${s.kind}) L${s.line}-L${s.endLine} (was ${s.oldLines} lines, now ${s.newLines} lines)`);
      }
      lines.push('');
    }

    if (added.length === 0 && removed.length === 0 && modified.length === 0) {
      lines.push('No semantic changes detected — symbol structure is identical to HEAD.');
    } else {
      lines.push(`${unchanged} symbol(s) unchanged.`);
    }

    return lines.join('\n');
  };
}

// ── Diagnostics Publish ──────────────────────────────────────────────

export interface DiagnosticPublishDeps {
  getCollection: () => vscode.DiagnosticCollection;
}

export function createCodeDiagnosticsPublishHandler(deps: DiagnosticPublishDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const action = String(kwargs.action);
    const collection = deps.getCollection();

    if (action === 'list') {
      const entries: string[] = [];
      let total = 0;
      collection.forEach((uri, diagnostics) => {
        for (const d of diagnostics) {
          const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR'
            : d.severity === vscode.DiagnosticSeverity.Warning ? 'WARN'
            : d.severity === vscode.DiagnosticSeverity.Hint ? 'HINT' : 'INFO';
          const fileRel = relPath(uri.fsPath);
          entries.push(`  ${fileRel}:${d.range.start.line + 1} [${sev}] ${d.message}`);
          total++;
        }
      });

      if (entries.length === 0) {
        return '[INFO] No active published diagnostics.';
      }
      return `[DIAGNOSTICS PUBLISH] ${total} active diagnostic(s)\n\n${entries.join('\n')}`;
    }

    if (action === 'clear') {
      if (kwargs.path) {
        const uri = resolveUri(String(kwargs.path));
        collection.delete(uri);
        return `[OK] Cleared diagnostics for ${relPath(uri.fsPath)}.`;
      }
      collection.clear();
      return '[OK] Cleared all published diagnostics.';
    }

    if (action === 'add') {
      if (!kwargs.path) {
        return '[ERROR] path is required for action "add".';
      }
      if (!kwargs.diagnostics) {
        return '[ERROR] diagnostics is required for action "add". Provide a JSON array: [{line, message, severity?, source?}]';
      }

      const uri = resolveUri(String(kwargs.path));
      let items: Array<{ line: number; message: string; severity?: string; source?: string; end_line?: number }>;
      try {
        items = typeof kwargs.diagnostics === 'string' ? JSON.parse(kwargs.diagnostics) : kwargs.diagnostics as any;
      } catch {
        return '[ERROR] Failed to parse diagnostics JSON. Expected array: [{line, message, severity?, source?}]';
      }

      if (!Array.isArray(items)) {
        return '[ERROR] diagnostics must be a JSON array.';
      }

      const sevMap: Record<string, vscode.DiagnosticSeverity> = {
        error: vscode.DiagnosticSeverity.Error,
        warning: vscode.DiagnosticSeverity.Warning,
        info: vscode.DiagnosticSeverity.Information,
        hint: vscode.DiagnosticSeverity.Hint,
      };

      const diags: vscode.Diagnostic[] = items.map((item) => {
        const line = Number(item.line) - 1;
        const endLine = item.end_line ? Number(item.end_line) - 1 : line;
        const range = new vscode.Range(line, 0, endLine, 999);
        const severity = sevMap[String(item.severity || 'warning').toLowerCase()] ?? vscode.DiagnosticSeverity.Warning;
        const diag = new vscode.Diagnostic(range, item.message, severity);
        diag.source = item.source || 'oboto';
        return diag;
      });

      // Merge with existing diagnostics for this file
      const existing = collection.get(uri) || [];
      collection.set(uri, [...existing, ...diags]);

      return `[OK] Published ${diags.length} diagnostic(s) to ${relPath(uri.fsPath)}.`;
    }

    return `[ERROR] Unknown action "${action}". Use "add", "clear", or "list".`;
  };
}

// ── Decorations ──────────────────────────────────────────────────────

export interface DecorationDeps {
  getManager: () => DecorationManager;
}

export class DecorationManager implements vscode.Disposable {
  private types = new Map<string, vscode.TextEditorDecorationType>();
  private appliedByFile = new Map<string, Array<{ typeKey: string; type: vscode.TextEditorDecorationType }>>();

  getOrCreateType(key: string, options: vscode.DecorationRenderOptions): vscode.TextEditorDecorationType {
    if (!this.types.has(key)) {
      this.types.set(key, vscode.window.createTextEditorDecorationType(options));
    }
    return this.types.get(key)!;
  }

  trackApplied(file: string, typeKey: string, type: vscode.TextEditorDecorationType): void {
    if (!this.appliedByFile.has(file)) this.appliedByFile.set(file, []);
    this.appliedByFile.get(file)!.push({ typeKey, type });
  }

  clearForFile(file: string): void {
    const entries = this.appliedByFile.get(file);
    if (entries) {
      for (const e of entries) {
        e.type.dispose();
        this.types.delete(e.typeKey);
      }
      this.appliedByFile.delete(file);
    }
  }

  clearAll(): void {
    for (const type of this.types.values()) type.dispose();
    this.types.clear();
    this.appliedByFile.clear();
  }

  getFileSummary(): Map<string, number> {
    const summary = new Map<string, number>();
    for (const [file, entries] of this.appliedByFile) {
      summary.set(file, entries.length);
    }
    return summary;
  }

  dispose(): void {
    this.clearAll();
  }
}

export function createCodeDecorateHandler(deps: DecorationDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const action = String(kwargs.action);
    const manager = deps.getManager();

    if (action === 'list') {
      const summary = manager.getFileSummary();
      if (summary.size === 0) {
        return '[INFO] No active decorations.';
      }
      const lines = [`[DECORATE] ${summary.size} file(s) with active decorations`, ''];
      for (const [file, count] of summary) {
        lines.push(`  ${file}: ${count} decoration group(s)`);
      }
      return lines.join('\n');
    }

    if (action === 'clear') {
      if (kwargs.path) {
        const fileRel = relPath(resolveUri(String(kwargs.path)).fsPath);
        manager.clearForFile(fileRel);
        return `[OK] Cleared decorations for ${fileRel}.`;
      }
      manager.clearAll();
      return '[OK] Cleared all decorations.';
    }

    if (action === 'add') {
      if (!kwargs.path) {
        return '[ERROR] path is required for action "add".';
      }
      if (!kwargs.decorations) {
        return '[ERROR] decorations is required for action "add". Provide a JSON array: [{line, end_line?, text?, color?, style?}]';
      }

      const filePath = String(kwargs.path);
      const uri = resolveUri(filePath);
      const fileRel = relPath(uri.fsPath);

      let items: Array<{ line: number; end_line?: number; text?: string; color?: string; style?: string }>;
      try {
        items = typeof kwargs.decorations === 'string' ? JSON.parse(kwargs.decorations) : kwargs.decorations as any;
      } catch {
        return '[ERROR] Failed to parse decorations JSON.';
      }

      if (!Array.isArray(items)) {
        return '[ERROR] decorations must be a JSON array.';
      }

      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch {
        return `[ERROR] File not found: ${filePath}.`;
      }

      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true });

      const colorMap: Record<string, string> = {
        yellow: 'rgba(255, 255, 0, 0.2)',
        red: 'rgba(255, 0, 0, 0.2)',
        green: 'rgba(0, 255, 0, 0.15)',
        blue: 'rgba(0, 100, 255, 0.15)',
        orange: 'rgba(255, 165, 0, 0.2)',
      };

      const groupKey = (item: { color?: string; style?: string }) => `${item.style || 'highlight'}:${item.color || 'yellow'}`;
      const groups = new Map<string, Array<{ line: number; end_line?: number; text?: string }>>();
      for (const item of items) {
        const key = groupKey(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      let totalDecorations = 0;

      for (const [key, groupItems] of groups) {
        const [style, color] = key.split(':');
        const resolvedColor = colorMap[color] || color;
        const typeKey = `oboto-${fileRel}-${key}-${Date.now()}`;

        const renderOptions: vscode.DecorationRenderOptions = {};
        switch (style) {
          case 'underline':
            renderOptions.textDecoration = `underline wavy ${color}`;
            break;
          case 'border':
            renderOptions.border = `1px solid ${resolvedColor}`;
            renderOptions.borderRadius = '3px';
            break;
          case 'gutter':
            renderOptions.overviewRulerColor = resolvedColor;
            renderOptions.overviewRulerLane = vscode.OverviewRulerLane.Right;
            break;
          default: // 'highlight'
            renderOptions.backgroundColor = resolvedColor;
            break;
        }

        if (groupItems.some((i) => i.text)) {
          renderOptions.after = { margin: '0 0 0 1em', color: new vscode.ThemeColor('editorCodeLens.foreground') };
        }

        const decType = manager.getOrCreateType(typeKey, renderOptions);
        const ranges: vscode.DecorationOptions[] = groupItems.map((item) => {
          const startLine = Math.max(0, Math.min(Number(item.line) - 1, doc.lineCount - 1));
          const endLine = Math.max(0, Math.min(item.end_line ? Number(item.end_line) - 1 : startLine, doc.lineCount - 1));
          const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
          const opts: vscode.DecorationOptions = { range };
          if (item.text) {
            opts.renderOptions = { after: { contentText: `  ${item.text}` } };
          }
          return opts;
        });

        editor.setDecorations(decType, ranges);
        manager.trackApplied(fileRel, typeKey, decType);
        totalDecorations += ranges.length;
      }

      return `[OK] Added ${totalDecorations} decoration(s) to ${fileRel}.`;
    }

    return `[ERROR] Unknown action "${action}". Use "add", "clear", or "list".`;
  };
}
