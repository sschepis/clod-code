/**
 * SkillManager — workspace-scoped registry of agent skills.
 *
 * A "skill" is a markdown file under `.clodcode/skills/**\/*.md` with
 * optional YAML frontmatter:
 *
 *   ---
 *   name: pr-review          # optional; defaults to filename stem
 *   description: Review PRs  # shown in the system prompt
 *   when: mention "PR"       # free-form hint the agent uses to decide when to invoke
 *   ---
 *
 *   # PR Review skill body
 *
 *   Steps to review a PR:
 *   1. ...
 *
 * The manager:
 *   - scans `.clodcode/skills` recursively on construction and file changes
 *   - parses frontmatter (simple key: value pairs; no nested YAML)
 *   - exposes `list()` for tool listing, `get(name)` for full body retrieval
 *   - exposes `systemPromptSnippet()` so the agent knows what skills exist
 *
 * Skills are accessed by the agent via the `skill list` and `skill get`
 * tools. The agent reads the full body with `skill get <name>` and follows
 * the instructions for the remainder of the turn.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../shared/logger';

export interface SkillMeta {
  /** Unique identifier, slash-separated if nested (e.g. `devops/deploy`). */
  name: string;
  /** One-line description shown in the system prompt and `skill list`. */
  description: string;
  /** Optional hint about when this skill applies. */
  when?: string;
  /** Absolute path to the source markdown file. */
  filePath: string;
  /** Any extra frontmatter keys, preserved for future use. */
  extra: Record<string, string>;
}

export interface Skill extends SkillMeta {
  /** Full markdown body (everything after the frontmatter). */
  body: string;
}

/** Cap the total size of the system-prompt skill listing to avoid token bloat. */
const MAX_SYSTEM_PROMPT_SKILLS_CHARS = 2000;

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

export function skillsDir(root: string): string {
  return path.join(root, '.clodcode', 'skills');
}

export class SkillManager {
  private skills = new Map<string, Skill>();
  private watcher?: vscode.FileSystemWatcher;
  private reloadTimer?: NodeJS.Timeout;

  constructor() {
    this.reload();
    this.installWatcher();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
  }

  // ── Lookup ──────────────────────────────────────────────────────────

  /** Return skill metadata for every loaded skill, sorted by name. */
  list(): SkillMeta[] {
    return [...this.skills.values()]
      .map(({ body: _body, ...meta }) => {
        void _body;
        return meta;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Return the full skill (including body) by name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Short summary suitable for inclusion in the agent system prompt. Lists
   * every skill as `name — description`. Truncates to keep token usage low.
   */
  systemPromptSnippet(): string {
    const entries = this.list();
    if (entries.length === 0) return '';

    const lines: string[] = [];
    let chars = 0;
    for (const e of entries) {
      const line = `- \`${e.name}\` — ${e.description || '(no description)'}${e.when ? ` [use when: ${e.when}]` : ''}`;
      if (chars + line.length > MAX_SYSTEM_PROMPT_SKILLS_CHARS) {
        lines.push(`- … and ${entries.length - lines.length} more (use \`skill list\` to see all)`);
        break;
      }
      lines.push(line);
      chars += line.length + 1;
    }

    return (
      '## Available Skills\n\n' +
      'These workspace skills are available. Invoke `skill get <name>` to load ' +
      'the full instructions for a skill, then follow them.\n\n' +
      lines.join('\n')
    );
  }

  // ── Scanning / parsing ──────────────────────────────────────────────

  /**
   * Re-scan `.clodcode/skills` from disk. Called on construction and
   * whenever the watcher fires.
   */
  reload(): void {
    this.skills.clear();
    const root = workspaceRoot();
    if (!root) return;
    const dir = skillsDir(root);
    if (!fs.existsSync(dir)) return;

    try {
      for (const file of walkMarkdown(dir)) {
        try {
          const skill = this.parseSkillFile(file, dir);
          if (!skill) continue;
          const existing = this.skills.get(skill.name);
          if (existing) {
            logger.warn(
              `Skill name collision: "${skill.name}" — using "${existing.filePath}", ignoring "${skill.filePath}"`,
            );
            continue;
          }
          this.skills.set(skill.name, skill);
        } catch (err) {
          logger.warn(`Failed to parse skill file "${file}"`, err);
        }
      }
      logger.info(`SkillManager: loaded ${this.skills.size} skill(s) from ${dir}`);
    } catch (err) {
      logger.warn('SkillManager: scan failed', err);
    }
  }

  private parseSkillFile(absPath: string, skillsRoot: string): Skill | null {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);

    const relative = path.relative(skillsRoot, absPath).replace(/\\/g, '/');
    const stem = relative.replace(/\.md$/i, '');

    const name = (frontmatter.name ?? stem).trim();
    const description = (frontmatter.description ?? '').trim();
    const when = frontmatter.when?.trim();

    if (!name) return null;

    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(frontmatter)) {
      if (k !== 'name' && k !== 'description' && k !== 'when') extra[k] = v;
    }

    return {
      name,
      description: description || '(no description)',
      when,
      filePath: absPath,
      extra,
      body: body.trim(),
    };
  }

  // ── Watcher ─────────────────────────────────────────────────────────

  private installWatcher(): void {
    if (!vscode.workspace.workspaceFolders?.length) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(
      '**/.clodcode/skills/**/*.md',
    );
    const schedule = () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.reload(), 200);
    };
    this.watcher.onDidCreate(schedule);
    this.watcher.onDidChange(schedule);
    this.watcher.onDidDelete(schedule);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function* walkMarkdown(dir: string): IterableIterator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkMarkdown(full);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      yield full;
    }
  }
}

/**
 * Minimal YAML frontmatter parser — supports `key: value` pairs between
 * leading `---` delimiters. Values may be quoted. Does NOT support nested
 * mappings, lists, anchors, or any YAML beyond flat strings. That is
 * intentional: skills are markdown-first, frontmatter is just metadata.
 */
export function parseFrontmatter(text: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  // Must start with ---\n (possibly with CRLF)
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: text };
  }

  const [, rawFrontmatter, body] = match;
  const fm: Record<string, string> = {};
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip single or double quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }

  return { frontmatter: fm, body: body ?? '' };
}
