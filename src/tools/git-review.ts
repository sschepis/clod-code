import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { REVIEW_PROMPT, EMPTY_DIFF_PROMPT } from '../prompts/review';

const MAX_DIFF_CHARS = 100_000;
const MAX_FILE_DIFF_CHARS = 10_000;

// ── Git helper (larger buffer/timeout than git-ops.ts for review diffs) ──

function git(args: string, cwd?: string): string {
  const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  return execSync(`git ${args}`, {
    cwd: workDir,
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

// ── Types ──

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  oldPath?: string;
}

interface DiffResult {
  files: DiffFile[];
  raw: string;
}

// ── Diff parsing ──

function parseFileDiff(content: string): DiffFile | null {
  const lines = content.split('\n');

  const headerMatch = lines[0]?.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!headerMatch) return null;

  const oldPath = headerMatch[1];
  const newPath = headerMatch[2];

  let status: DiffFile['status'] = 'modified';
  const isNew = lines.some((l) => l.startsWith('new file mode'));
  const isDeleted = lines.some((l) => l.startsWith('deleted file mode'));
  const isRenamed = lines.some((l) => l.startsWith('rename from'));

  if (isNew) status = 'added';
  else if (isDeleted) status = 'deleted';
  else if (isRenamed) status = 'renamed';

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let hunkContent: string[] = [];

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) {
        currentHunk.content = hunkContent.join('\n');
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: parseInt(hunkMatch[2] || '1', 10),
        newStart: parseInt(hunkMatch[3], 10),
        newLines: parseInt(hunkMatch[4] || '1', 10),
        content: '',
      };
      hunkContent = [line];
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      hunkContent.push(line);
    }
  }

  if (currentHunk) {
    currentHunk.content = hunkContent.join('\n');
    hunks.push(currentHunk);
  }

  return {
    path: newPath,
    status,
    hunks,
    ...(isRenamed && oldPath !== newPath ? { oldPath } : {}),
  };
}

function parseDiff(raw: string): DiffResult {
  if (!raw.trim()) return { files: [], raw };

  const fileDiffs = raw.split(/^diff --git /m).filter(Boolean);
  const files: DiffFile[] = [];

  for (const fileDiff of fileDiffs) {
    const file = parseFileDiff('diff --git ' + fileDiff);
    if (file) files.push(file);
  }

  return { files, raw };
}

// ── Git queries ──

function getCurrentBranch(): string {
  return git('rev-parse --abbrev-ref HEAD');
}

function getBaseBranch(): string {
  const candidates = ['main', 'master', 'dev', 'develop'];

  for (const branch of candidates) {
    try {
      git(`show-ref --verify --quiet refs/remotes/origin/${branch}`);
      return `origin/${branch}`;
    } catch { /* not found */ }
  }

  for (const branch of candidates) {
    try {
      git(`show-ref --verify --quiet refs/heads/${branch}`);
      return branch;
    } catch { /* not found */ }
  }

  return 'HEAD~1';
}

function getUncommittedChanges(): DiffResult {
  try {
    const raw = git('-c core.quotepath=false diff HEAD');
    return parseDiff(raw);
  } catch {
    return { files: [], raw: '' };
  }
}

function getBranchChanges(baseBranch?: string): DiffResult {
  const base = baseBranch || getBaseBranch();
  try {
    const raw = git(`-c core.quotepath=false diff ${base}...HEAD`);
    return parseDiff(raw);
  } catch {
    return { files: [], raw: '' };
  }
}

// ── Formatting ──

function countChanges(file: DiffFile): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.content.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
  }
  return { additions, deletions };
}

function formatFileList(files: DiffFile[]): string {
  return files
    .map((f) => {
      const badge = f.status === 'added' ? '[A]' : f.status === 'deleted' ? '[D]' : f.status === 'renamed' ? '[R]' : '[M]';
      const renamed = f.oldPath ? ` (was: ${f.oldPath})` : '';
      const { additions, deletions } = countChanges(f);
      return `- ${badge} ${f.path}${renamed} (+${additions}, -${deletions})`;
    })
    .join('\n');
}

function buildToolsSection(scope: 'uncommitted' | 'branch', baseBranch?: string, currentBranch?: string): string {
  if (scope === 'uncommitted') {
    return `Use these git commands to explore the changes:
  - View all changes: \`git diff && git diff --cached\`
  - View specific file change: \`git diff -- <file> && git diff --cached -- <file>\`
  - View commit history: \`git log\`
  - View file history: \`git blame <file>\``;
  }
  return `Use these git commands to explore the changes:
  - View branch diff: \`git diff ${baseBranch}...${currentBranch}\`
  - View specific file diff: \`git diff ${baseBranch}...${currentBranch} -- <file>\`
  - View commit history: \`git log\`
  - View file history: \`git blame <file>\``;
}

function truncateDiff(raw: string): string {
  if (raw.length <= MAX_DIFF_CHARS) return raw;

  const fileDiffs = raw.split(/^(?=diff --git )/m);
  let total = 0;
  const kept: string[] = [];

  for (const fd of fileDiffs) {
    if (fd.length > MAX_FILE_DIFF_CHARS) {
      const truncated = fd.slice(0, MAX_FILE_DIFF_CHARS) + '\n[... file diff truncated, use git/diff with file path for full content ...]\n';
      if (total + truncated.length > MAX_DIFF_CHARS) break;
      kept.push(truncated);
      total += truncated.length;
    } else {
      if (total + fd.length > MAX_DIFF_CHARS) break;
      kept.push(fd);
      total += fd.length;
    }
  }

  if (kept.length < fileDiffs.length) {
    kept.push(`\n[DIFF TRUNCATED: Showing ${kept.length} of ${fileDiffs.length} files. Use git/diff with specific file paths to review remaining files.]`);
  }

  return kept.join('');
}

// ── Prompt assembly ──

function buildReviewPromptBranch(baseBranch?: string): string {
  const base = baseBranch || getBaseBranch();
  const currentBranch = getCurrentBranch();
  const diff = getBranchChanges(base);

  const scopeDescription = `**branch diff**: \`${currentBranch}\` -> \`${base}\``;

  if (diff.files.length === 0) {
    return EMPTY_DIFF_PROMPT.replaceAll('${SCOPE_DESCRIPTION}', scopeDescription);
  }

  const fileList = formatFileList(diff.files);
  const tools = buildToolsSection('branch', base, currentBranch);
  const truncatedDiff = truncateDiff(diff.raw);

  return REVIEW_PROMPT
    .replaceAll('${SCOPE_DESCRIPTION}', scopeDescription)
    .replace('${FILE_LIST}', fileList)
    .replace('${TOOLS}', tools)
    + '\n\n## Diff\n\n```diff\n' + truncatedDiff + '\n```\n';
}

function buildReviewPromptUncommitted(): string {
  const diff = getUncommittedChanges();

  const scopeDescription = '**uncommitted changes**';

  if (diff.files.length === 0) {
    return EMPTY_DIFF_PROMPT.replaceAll('${SCOPE_DESCRIPTION}', scopeDescription);
  }

  const fileList = formatFileList(diff.files);
  const tools = buildToolsSection('uncommitted');
  const truncatedDiff = truncateDiff(diff.raw);

  return REVIEW_PROMPT
    .replaceAll('${SCOPE_DESCRIPTION}', scopeDescription)
    .replace('${FILE_LIST}', fileList)
    .replace('${TOOLS}', tools)
    + '\n\n## Diff\n\n```diff\n' + truncatedDiff + '\n```\n';
}

// ── Exported tool handlers ──

export function createGitReviewHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const baseBranch = typeof kwargs.base === 'string' ? kwargs.base.trim() : undefined;
    try {
      return buildReviewPromptBranch(baseBranch);
    } catch (err: any) {
      return `[ERROR] git review failed: ${err.message}`;
    }
  };
}

export function createGitReviewUncommittedHandler() {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    try {
      return buildReviewPromptUncommitted();
    } catch (err: any) {
      return `[ERROR] git review-uncommitted failed: ${err.message}`;
    }
  };
}
