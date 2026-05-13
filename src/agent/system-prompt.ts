import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SYSTEM_PROMPT } from '../config/defaults';
import type { SkillManager } from '../skills/skill-manager';
import type { ProjectManager } from '../projects/project-manager';

const MAX_INSTRUCTION_FILE_CHARS = 4000;
const MAX_TOTAL_INSTRUCTION_CHARS = 12000;

const INSTRUCTION_CACHE_TTL_MS = 30_000;
let instructionCache: { key: string; content: string | null; timestamp: number } | null = null;

export function invalidateSystemPromptCache(): void {
  instructionCache = null;
}

export interface BuildSystemPromptOptions {
  instructionFileName: string;
  /** Optional — when provided, the available-skills section is appended. */
  skills?: SkillManager;
  /** Optional — when provided, active project context is appended. */
  projects?: ProjectManager;
}

/**
 * Assemble the full system prompt from static instructions,
 * project instruction files (CLAUDE.md), available skills, and runtime context.
 *
 * Signature is overloaded for backward compat: callers can pass either
 * a string (legacy — instruction file name only) or the options object.
 */
export function buildSystemPrompt(instructionFileName: string): string;
export function buildSystemPrompt(options: BuildSystemPromptOptions): string;
export function buildSystemPrompt(arg: string | BuildSystemPromptOptions): string {
  const options: BuildSystemPromptOptions =
    typeof arg === 'string' ? { instructionFileName: arg } : arg;

  const parts: string[] = [DEFAULT_SYSTEM_PROMPT];

  // Project instructions (CLAUDE.md discovery)
  const instructionContent = discoverInstructionFiles(options.instructionFileName);
  if (instructionContent) {
    parts.push('\n\n## Project Instructions\n' + instructionContent);
  }

  // Workspace skills — the agent sees names + descriptions and can load
  // full bodies on demand via `skill get <name>`.
  const skillsSnippet = options.skills?.systemPromptSnippet();
  if (skillsSnippet) {
    parts.push('\n\n' + skillsSnippet);
  }

  // Active project context — conventions, plans, guidelines
  const projectSnippet = options.projects?.systemPromptSnippet();
  if (projectSnippet) {
    parts.push('\n\n' + projectSnippet);
  }

  // Runtime context
  parts.push('\n\n## Environment');
  parts.push(`- Date: ${new Date().toISOString().split('T')[0]}`);
  parts.push(`- Platform: ${process.platform}`);

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    parts.push(`- Workspace: ${folders.map(f => f.name).join(', ')}`);
    parts.push(`- Root: ${folders[0].uri.fsPath}`);
  }

  return parts.join('\n');
}

function discoverInstructionFiles(fileName: string): string | null {
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!rootPath) return null;

  const cacheKey = `${rootPath}:${fileName}`;
  if (instructionCache && instructionCache.key === cacheKey &&
      Date.now() - instructionCache.timestamp < INSTRUCTION_CACHE_TTL_MS) {
    return instructionCache.content;
  }

  const files: string[] = [];
  let totalChars = 0;

  // Check workspace root first
  const rootFile = path.join(rootPath, fileName);
  if (fs.existsSync(rootFile)) {
    try {
      let content = fs.readFileSync(rootFile, 'utf-8');
      if (content.length > MAX_INSTRUCTION_FILE_CHARS) {
        content = content.slice(0, MAX_INSTRUCTION_FILE_CHARS) + '\n\n[... truncated]';
      }
      files.push(`### ${fileName}\n${content}`);
      totalChars += content.length;
    } catch { /* ignore */ }
  }

  // Walk into subdirectories (breadth-first, max 3 levels deep)
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }];
  while (queue.length > 0 && totalChars < MAX_TOTAL_INSTRUCTION_CHARS) {
    const { dir, depth } = queue.shift()!;
    if (depth > 3) continue;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push({ dir: fullPath, depth: depth + 1 });
      } else if (entry.isFile() && entry.name === fileName && fullPath !== rootFile) {
        try {
          let content = fs.readFileSync(fullPath, 'utf-8');
          if (content.length > MAX_INSTRUCTION_FILE_CHARS) {
            content = content.slice(0, MAX_INSTRUCTION_FILE_CHARS) + '\n\n[... truncated]';
          }
          if (totalChars + content.length <= MAX_TOTAL_INSTRUCTION_CHARS) {
            files.push(`### ${path.relative(rootPath, fullPath)}\n${content}`);
            totalChars += content.length;
          }
        } catch { /* ignore */ }
      }
    }
  }

  const result = files.length > 0 ? files.join('\n\n') : null;
  instructionCache = { key: cacheKey, content: result, timestamp: Date.now() };
  return result;
}
