import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { PipelineEngine, type IFileSystem, type IASTManager, type IUtils, type PipelineResponse } from './aegis-pipe';

// ── Filesystem adapter using VS Code APIs ─────────────────────────

class VscodeFileSystem implements IFileSystem {
  async readFile(filePath: string): Promise<string> {
    const uri = vscode.Uri.file(filePath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);

    // Use WorkspaceEdit for undo support when file is open
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
    if (doc) {
      const existing = doc.getText();
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(existing.length),
      );
      edit.replace(uri, fullRange, content);
      await vscode.workspace.applyEdit(edit);
    } else {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    }
  }
}

// ── Utilities adapter ─────────────────────────────────────────────

class RefactorUtils implements IUtils {
  generateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  }

  generateUnifiedDiff(original: string, modified: string, filepath: string): string {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    const out: string[] = [`--- ${filepath}`, `+++ ${filepath}`];

    // Simple line-by-line diff (not a full Myers diff, but good enough for pipeline output)
    const maxLen = Math.max(origLines.length, modLines.length);
    let hunkStart = -1;
    let hunkOrig: string[] = [];
    let hunkMod: string[] = [];

    const flushHunk = () => {
      if (hunkStart === -1) return;
      out.push(`@@ -${hunkStart + 1},${hunkOrig.length} +${hunkStart + 1},${hunkMod.length} @@`);
      for (const l of hunkOrig) out.push(`-${l}`);
      for (const l of hunkMod) out.push(`+${l}`);
      hunkStart = -1;
      hunkOrig = [];
      hunkMod = [];
    };

    for (let i = 0; i < maxLen; i++) {
      const ol = origLines[i];
      const ml = modLines[i];
      if (ol === ml) {
        flushHunk();
      } else {
        if (hunkStart === -1) hunkStart = i;
        if (ol !== undefined) hunkOrig.push(ol);
        if (ml !== undefined) hunkMod.push(ml);
      }
    }
    flushHunk();
    return out.join('\n');
  }

  guessLanguage(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'javascript',
      '.py': 'python', '.go': 'go', '.rs': 'rust', '.rb': 'ruby',
      '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
      '.cs': 'c_sharp', '.swift': 'swift', '.kt': 'kotlin',
    };
    return map[ext] || 'unknown';
  }
}

// ── Stub AST manager (tree-sitter loading deferred until needed) ──

class StubASTManager implements IASTManager {
  parse(_content: string, _language?: any) {
    return null;
  }

  renameSymbol(_tree: any, _config: any, _sourceCode: string): string {
    throw new Error(
      'AST rename requires tree-sitter language grammars. ' +
      'Use the regex_replace step for text-based renaming, or install the appropriate WASM grammar.',
    );
  }
}

// ── Singleton engine ──────────────────────────────────────────────

let engine: PipelineEngine | undefined;

function getEngine(): PipelineEngine {
  if (!engine) {
    engine = new PipelineEngine(
      new VscodeFileSystem(),
      new StubASTManager(),
      new RefactorUtils(),
    );
  }
  return engine;
}

// ── Tool handlers ─────────────────────────────────────────────────

function resolveFilePath(rawPath: string): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) return path.join(folders[0].uri.fsPath, rawPath);
  return rawPath;
}

function formatResponse(resp: PipelineResponse): string {
  const lines: string[] = [];

  if (resp.status === 'success') {
    lines.push(`[SUCCESS] Pipeline ${resp.pipeline_state} (${resp.execution_time_ms}ms)`);
  } else {
    lines.push(`[${resp.status.toUpperCase()}] Pipeline ${resp.pipeline_state} (${resp.execution_time_ms}ms)`);
  }

  lines.push(`Hash: ${resp.original_state_hash}${resp.final_state_hash ? ' → ' + resp.final_state_hash : ''}`);

  for (const sr of resp.step_results) {
    const icon = sr.status === 'success' ? '✓' : '✗';
    lines.push(`  ${icon} Step ${sr.step_index}: ${sr.status}${sr.mutations ? ` (${sr.mutations} mutation${sr.mutations > 1 ? 's' : ''})` : ''}${sr.message ? ' — ' + sr.message : ''}`);
  }

  if (resp.error_report) {
    const er = resp.error_report;
    lines.push('');
    lines.push(`Error [${er.code}]: ${er.message}`);
    if (er.recovery_hints.length) {
      lines.push('Recovery hints:');
      for (const h of er.recovery_hints) lines.push(`  • ${h}`);
    }
  }

  if (resp.unified_diff) {
    lines.push('');
    lines.push(resp.unified_diff);
  }

  return lines.join('\n');
}

/**
 * Run a full pipeline against a target file.
 * Accepts the raw PipelineRequest JSON as kwargs.
 */
export function createRefactorPipelineHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const targetFile = String(kwargs.target_file || '');
    if (!targetFile) return '[ERROR] Missing required argument: target_file';

    const mode = String(kwargs.execution_mode || 'dry_run');
    if (mode !== 'dry_run' && mode !== 'apply') {
      return '[ERROR] execution_mode must be "dry_run" or "apply"';
    }

    let pipeline: unknown[];
    try {
      pipeline = typeof kwargs.pipeline === 'string'
        ? JSON.parse(kwargs.pipeline)
        : kwargs.pipeline as unknown[];
      if (!Array.isArray(pipeline) || pipeline.length === 0) {
        return '[ERROR] pipeline must be a non-empty array of step objects';
      }
    } catch {
      return '[ERROR] pipeline must be a valid JSON array of step objects';
    }

    const resolved = resolveFilePath(targetFile);
    const resp = await getEngine().execute({
      target_file: resolved,
      execution_mode: mode,
      pipeline,
    });

    return formatResponse(resp);
  };
}

/**
 * Quick regex replace — a convenience wrapper for the most common pipeline step.
 */
export function createRefactorRegexHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const targetFile = String(kwargs.target_file || '');
    const pattern = String(kwargs.pattern || '');
    const replacement = String(kwargs.replacement ?? '');
    const mode = String(kwargs.execution_mode || 'dry_run');

    if (!targetFile) return '[ERROR] Missing required argument: target_file';
    if (!pattern) return '[ERROR] Missing required argument: pattern';

    const resolved = resolveFilePath(targetFile);
    const resp = await getEngine().execute({
      target_file: resolved,
      execution_mode: mode,
      pipeline: [{ step: 'regex_replace', config: { pattern, replacement } }],
    });

    return formatResponse(resp);
  };
}
