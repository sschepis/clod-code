export interface CodeMapSymbol {
  id: string;
  name: string;
  kind: string;
  file: string;
  line: number;
  endLine?: number;
  signature?: string;
  discoveredBy: string;
}

export interface CodeMapRelation {
  from: string;
  to: string;
  kind: 'calls' | 'imports' | 'references' | 'defines' | 'extends' | 'implements';
  file: string;
  line: number;
}

export interface CodeMapFile {
  path: string;
  language: string;
  symbolCount: number;
  lastExploredAt: number;
  explored: boolean;
}

export interface CodeMapDeps {
  getMap: () => CodeMap;
}

export class CodeMap {
  private symbols = new Map<string, CodeMapSymbol>();
  private relations: CodeMapRelation[] = [];
  private files = new Map<string, CodeMapFile>();

  recordFile(path: string, language: string, symbolCount: number): void {
    this.files.set(path, {
      path,
      language,
      symbolCount,
      lastExploredAt: Date.now(),
      explored: true,
    });
  }

  recordSymbol(sym: CodeMapSymbol): void {
    this.symbols.set(sym.id, sym);
  }

  recordRelation(rel: CodeMapRelation): void {
    const exists = this.relations.some(
      (r) => r.from === rel.from && r.to === rel.to && r.kind === rel.kind,
    );
    if (!exists) this.relations.push(rel);
  }

  touchFile(path: string): void {
    const existing = this.files.get(path);
    if (existing) {
      existing.lastExploredAt = Date.now();
    } else {
      this.files.set(path, {
        path,
        language: '',
        symbolCount: 0,
        lastExploredAt: Date.now(),
        explored: false,
      });
    }
  }

  getSymbolsInFile(path: string): CodeMapSymbol[] {
    return [...this.symbols.values()].filter((s) => s.file === path);
  }

  getRelationsFor(symbolId: string): CodeMapRelation[] {
    return this.relations.filter((r) => r.from === symbolId || r.to === symbolId);
  }

  getExploredFiles(): CodeMapFile[] {
    return [...this.files.values()].filter((f) => f.explored);
  }

  getUnexploredReferences(): { path: string; inboundCount: number }[] {
    const explored = new Set(this.getExploredFiles().map((f) => f.path));
    const counts = new Map<string, number>();
    for (const rel of this.relations) {
      for (const sym of [this.symbols.get(rel.from), this.symbols.get(rel.to)]) {
        if (sym && !explored.has(sym.file)) {
          counts.set(sym.file, (counts.get(sym.file) || 0) + 1);
        }
      }
    }
    // Also include files touched but not explored
    for (const f of this.files.values()) {
      if (!f.explored && !counts.has(f.path)) {
        counts.set(f.path, 0);
      }
    }
    return [...counts.entries()]
      .map(([path, inboundCount]) => ({ path, inboundCount }))
      .sort((a, b) => b.inboundCount - a.inboundCount);
  }

  findSymbol(name: string): CodeMapSymbol | undefined {
    for (const sym of this.symbols.values()) {
      if (sym.name === name) return sym;
    }
    return undefined;
  }

  summary(): string {
    const fileCount = this.files.size;
    const exploredCount = this.getExploredFiles().length;
    const symbolCount = this.symbols.size;
    const relationCount = this.relations.length;

    if (fileCount === 0) {
      return '[CODE MAP] Empty — no files explored yet. Use code/symbols or code/definition to start building the map.';
    }

    const lines: string[] = [
      `[CODE MAP] ${exploredCount} file(s) explored | ${symbolCount} symbol(s) | ${relationCount} relation(s)`,
      '',
    ];

    const explored = this.getExploredFiles().sort((a, b) => b.lastExploredAt - a.lastExploredAt);
    if (explored.length > 0) {
      lines.push('Explored files:');
      for (const f of explored.slice(0, 20)) {
        lines.push(`  ${f.path} (${f.symbolCount} symbols, ${f.language})`);
      }
      if (explored.length > 20) lines.push(`  ... and ${explored.length - 20} more`);
    }

    const frontier = this.getUnexploredReferences();
    if (frontier.length > 0) {
      lines.push('');
      lines.push('Frontier (referenced but unexplored):');
      for (const f of frontier.slice(0, 10)) {
        const suffix = f.inboundCount > 0 ? ` (${f.inboundCount} inbound references)` : '';
        lines.push(`  ${f.path}${suffix}`);
      }
      if (frontier.length > 10) lines.push(`  ... and ${frontier.length - 10} more`);
    }

    return lines.join('\n');
  }

  queryArea(path: string): string {
    const syms = this.getSymbolsInFile(path);
    if (syms.length === 0) {
      const file = this.files.get(path);
      if (!file) return `[CODE MAP] No data for ${path}. Use code/symbols to explore it.`;
      if (!file.explored) return `[CODE MAP] ${path} was referenced but not yet explored.`;
      return `[CODE MAP] ${path} explored but no symbols found.`;
    }

    const lines = [`[CODE MAP] ${path} — ${syms.length} symbol(s)`, ''];
    for (const s of syms.sort((a, b) => a.line - b.line)) {
      const sig = s.signature ? ` — ${s.signature}` : '';
      lines.push(`  ${s.name} (${s.kind}) L${s.line}${s.endLine ? `-L${s.endLine}` : ''}${sig}`);
      const rels = this.getRelationsFor(s.id);
      for (const r of rels.slice(0, 5)) {
        const other = r.from === s.id ? r.to : r.from;
        const dir = r.from === s.id ? '→' : '←';
        lines.push(`    ${dir} ${r.kind} ${other} (${r.file}:${r.line})`);
      }
      if (rels.length > 5) lines.push(`    ... and ${rels.length - 5} more relations`);
    }

    return lines.join('\n');
  }

  querySymbol(name: string): string {
    const matches = [...this.symbols.values()].filter((s) => s.name === name);
    if (matches.length === 0) {
      return `[CODE MAP] No symbol "${name}" found. Use code/workspace-symbols to search for it.`;
    }

    const lines = [`[CODE MAP] "${name}" — ${matches.length} match(es)`, ''];
    for (const s of matches) {
      const sig = s.signature ? `\n  Type: ${s.signature}` : '';
      lines.push(`${s.name} (${s.kind}) at ${s.file}:${s.line}${sig}`);
      const rels = this.getRelationsFor(s.id);
      if (rels.length > 0) {
        for (const r of rels.slice(0, 10)) {
          const other = r.from === s.id ? r.to : r.from;
          const dir = r.from === s.id ? '→' : '←';
          lines.push(`  ${dir} ${r.kind} ${other} (${r.file}:${r.line})`);
        }
        if (rels.length > 10) lines.push(`  ... and ${rels.length - 10} more relations`);
      }
    }

    return lines.join('\n');
  }
}

export function createCodeMapHandler(deps: CodeMapDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const map = deps.getMap();
    const scope = String(kwargs.scope || 'summary');
    const query = kwargs.query ? String(kwargs.query) : undefined;

    switch (scope) {
      case 'file':
        if (!query) return '[ERROR] scope="file" requires a query (file path).';
        return map.queryArea(query);
      case 'symbol':
        if (!query) return '[ERROR] scope="symbol" requires a query (symbol name).';
        return map.querySymbol(query);
      case 'frontier':
        const frontier = map.getUnexploredReferences();
        if (frontier.length === 0) return '[CODE MAP] No unexplored references. The frontier is empty.';
        const lines = [`[CODE MAP] Frontier — ${frontier.length} unexplored file(s)`, ''];
        for (const f of frontier.slice(0, 20)) {
          const suffix = f.inboundCount > 0 ? ` (${f.inboundCount} inbound references)` : '';
          lines.push(`  ${f.path}${suffix}`);
        }
        return lines.join('\n');
      case 'relations': {
        const rels = query
          ? map.getRelationsFor(query)
          : [];
        if (rels.length === 0) return query
          ? `[CODE MAP] No relations found for "${query}".`
          : '[CODE MAP] Use scope="relations" with query="symbolId" to filter.';
        const rLines = [`[CODE MAP] Relations for "${query}" — ${rels.length}`, ''];
        for (const r of rels.slice(0, 30)) {
          rLines.push(`  ${r.from} → ${r.kind} → ${r.to} (${r.file}:${r.line})`);
        }
        return rLines.join('\n');
      }
      case 'summary':
      default:
        return map.summary();
    }
  };
}
