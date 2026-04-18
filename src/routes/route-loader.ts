import * as fs from 'fs';
import * as path from 'path';

export type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string };

export interface RouteEntry {
  /** Segments relative to the routes root (excluding the terminal `route.js`). */
  segments: Segment[];
  /** Absolute path to the route file on disk. */
  file: string;
  /** The URL path with `:param` placeholders, e.g. `/users/:id`. */
  urlPath: string;
}

const ROUTE_FILE_NAMES = ['route.js', 'route.mjs'];

export function routesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.clodcode', 'routes');
}

function parseSegment(part: string): Segment {
  if (part.startsWith('[') && part.endsWith(']')) {
    const name = part.slice(1, -1);
    if (!name || name.startsWith('...')) {
      // Catch-all segments not supported in v1 — treat as static placeholder
      return { kind: 'static', value: part };
    }
    return { kind: 'param', name };
  }
  return { kind: 'static', value: part };
}

/** Walks `.clodcode/routes/` and returns every routable file. */
export function scanRoutes(workspaceRoot: string): RouteEntry[] {
  const root = routesDir(workspaceRoot);
  if (!fs.existsSync(root)) return [];

  const entries: RouteEntry[] = [];

  const walk = (dir: string, segments: Segment[]) => {
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // First, look for a route file in this directory.
    for (const name of ROUTE_FILE_NAMES) {
      if (children.some((c) => c.isFile() && c.name === name)) {
        const file = path.join(dir, name);
        const urlPath =
          '/' + segments.map((s) => (s.kind === 'static' ? s.value : `:${s.name}`)).join('/');
        entries.push({
          segments: [...segments],
          file,
          urlPath: urlPath === '/' ? '/' : urlPath,
        });
        break;
      }
    }

    // Then recurse into subdirectories.
    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (child.name.startsWith('.')) continue;
      walk(path.join(dir, child.name), [...segments, parseSegment(child.name)]);
    }
  };

  walk(root, []);
  return entries;
}

export interface MatchResult {
  entry: RouteEntry;
  params: Record<string, string>;
}

/** Match an URL pathname (already stripped of `/api` prefix) against the table. */
export function matchRoute(entries: RouteEntry[], pathname: string): MatchResult | null {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = clean === '' ? [] : clean.split('/').map(decodeURIComponent);

  for (const entry of entries) {
    if (entry.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = entry.segments[i];
      if (seg.kind === 'static') {
        if (seg.value !== parts[i]) { ok = false; break; }
      } else {
        params[seg.name] = parts[i];
      }
    }
    if (ok) return { entry, params };
  }
  return null;
}
