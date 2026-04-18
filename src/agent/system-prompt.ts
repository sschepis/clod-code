import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SYSTEM_PROMPT } from '../config/defaults';
import type { SkillManager } from '../skills/skill-manager';

const MAX_INSTRUCTION_FILE_CHARS = 4000;
const MAX_TOTAL_INSTRUCTION_CHARS = 12000;

export interface BuildSystemPromptOptions {
  instructionFileName: string;
  /** Optional — when provided, the available-skills section is appended. */
  skills?: SkillManager;
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

  parts.push(
    '\n\n## Hierarchical Memory\n' +
    'You have durable memory across three scopes. Commands live under `memory/*`:\n' +
    '- `memory/recall query="..." scope?="all|conversation|project|global"` — search by resonance.\n' +
    '- `memory/add title="..." body="..." tags?="csv"` — record a durable fact in THIS conversation.\n' +
    '- `memory/promote id="..." to="project|global"` — elevate a noteworthy entry upward.\n' +
    '- `memory/list scope?="conversation|project|global"` — recent entries in a scope.\n' +
    '- `memory/forget id="..."` — remove an entry.\n' +
    'Scopes: conversation (this session; given to any agent spawned from here), project (this workspace, persists across sessions), global (across all workspaces). Promote sparingly — only facts that stay true for the whole project or for the user in general. Tool-call outputs are auto-captured at low strength; promote the ones worth keeping.',
  );

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

  const files: string[] = [];
  let totalChars = 0;
  let currentDir = rootPath;

  // Walk from workspace root upward to find instruction files
  while (true) {
    const filePath = path.join(currentDir, fileName);
    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf-8');
        if (content.length > MAX_INSTRUCTION_FILE_CHARS) {
          content = content.slice(0, MAX_INSTRUCTION_FILE_CHARS) + '\n\n[... truncated]';
        }
        if (totalChars + content.length <= MAX_TOTAL_INSTRUCTION_CHARS) {
          files.push(`### ${path.relative(rootPath, filePath) || fileName}\n${content}`);
          totalChars += content.length;
        }
      } catch {
        // Ignore unreadable files
      }
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) break; // Reached filesystem root
    currentDir = parent;
  }

  return files.length > 0 ? files.join('\n\n') : null;
}
