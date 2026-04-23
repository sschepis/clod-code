import * as vscode from 'vscode';

/**
 * Normalize whitespace for fuzzy comparison: collapse runs of spaces/tabs
 * to single space and trim each line, but preserve line structure.
 */
function normalizeWS(s: string): string {
  return s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n');
}

// LLMs frequently substitute visually similar Unicode characters.
// Map confusable code points to their canonical ASCII equivalents.
const CONFUSABLES = new Map<number, string>([
  // Box-drawing horizontals → hyphen
  [0x2500, '-'], [0x2501, '-'], [0x2502, '|'], [0x2503, '|'],
  [0x2550, '='],
  // Dashes → hyphen
  [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2013, '-'], [0x2014, '-'], [0x2015, '-'],
  [0x2043, '-'], [0xFE58, '-'], [0xFE63, '-'], [0xFF0D, '-'],
  // Smart quotes → ASCII quotes
  [0x201C, '"'], [0x201D, '"'], [0x201E, '"'], [0x201F, '"'],
  [0x2018, "'"], [0x2019, "'"], [0x201A, "'"], [0x201B, "'"],
  [0xFF02, '"'], [0xFF07, "'"],
  // Spaces → ASCII space (or empty for zero-width)
  [0x00A0, ' '], [0x2002, ' '], [0x2003, ' '], [0x2004, ' '],
  [0x2005, ' '], [0x2006, ' '], [0x2007, ' '], [0x2008, ' '],
  [0x2009, ' '], [0x200A, ' '],
  [0x200B, ''], [0xFEFF, ''],
  // Ellipsis → period (single char keeps index mapping simple)
  [0x2026, '.'],
]);

function normalizeUnicode(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const mapped = CONFUSABLES.get(cp);
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

/**
 * Try to find `needle` in `content` using Unicode-normalized matching.
 * Returns the actual substring from `content` that matches, or null.
 */
function unicodeMatch(content: string, needle: string): string | null {
  if (!/[^\x00-\x7F]/.test(needle) && !/[^\x00-\x7F]/.test(content)) return null;

  const normContent = normalizeUnicode(content);
  const normNeedle = normalizeUnicode(needle);
  const normIdx = normContent.indexOf(normNeedle);
  if (normIdx === -1) return null;

  // Map normalized char index back to original content char index.
  // Walk content char-by-char, tracking normalized output length.
  let normPos = 0;
  let origStart = -1;
  let origEnd = -1;
  const chars = [...content];
  for (let i = 0; i < chars.length; i++) {
    if (normPos === normIdx && origStart === -1) origStart = i;
    const cp = chars[i].codePointAt(0)!;
    const mapped = CONFUSABLES.get(cp);
    normPos += mapped !== undefined ? mapped.length : chars[i].length;
    if (normPos >= normIdx + normNeedle.length && origEnd === -1) {
      origEnd = i + 1;
      break;
    }
  }
  if (origStart === -1 || origEnd === -1) return null;
  return chars.slice(origStart, origEnd).join('');
}

/**
 * Annotate non-ASCII characters with their code points for diagnostics.
 */
function hexAnnotate(s: string, maxChars = 80): string {
  const chars = [...s].slice(0, maxChars);
  return chars.map(c => {
    const cp = c.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7E) return c;
    if (cp === 0x09) return '\\t';
    return `\\u{${cp.toString(16).toUpperCase()}}`;
  }).join('');
}

/**
 * Find the region in the file closest to what the agent likely intended.
 */
function findClosestRegion(content: string, needle: string): { line: number; actual: string } | null {
  const needleFirst = needle.split('\n')[0];
  if (needleFirst.length < 4) return null;

  const prefix = needleFirst.slice(0, Math.max(10, Math.floor(needleFirst.length * 0.4)));
  const normPrefix = normalizeUnicode(normalizeWS(prefix));
  const contentLines = content.split('\n');
  const needleLineCount = needle.split('\n').length;

  for (let i = 0; i < contentLines.length; i++) {
    const normLine = normalizeUnicode(normalizeWS(contentLines[i]));
    if (normLine.includes(normPrefix)) {
      const actual = contentLines.slice(i, i + needleLineCount).join('\n');
      return { line: i + 1, actual };
    }
  }
  return null;
}

/**
 * Find the line number (1-based) where `needle` starts in `haystack`.
 */
function findLineOf(haystack: string, needle: string): number {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return -1;
  return haystack.slice(0, idx).split('\n').length;
}

/**
 * Build a contextual diff showing surrounding lines with line numbers.
 */
function buildContextDiff(
  filePath: string,
  original: string,
  updated: string,
  oldStr: string,
  newStr: string,
  startLine: number,
  contextLines = 2,
): string {
  const origLines = original.split('\n');
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const regionStart = Math.max(0, startLine - 1 - contextLines);
  const regionEnd = Math.min(origLines.length, startLine - 1 + oldLines.length + contextLines);

  const header = `--- ${filePath}\n+++ ${filePath}`;
  const hunk = `@@ -${regionStart + 1},${regionEnd - regionStart} @@`;

  const lines: string[] = [header, hunk];

  for (let i = regionStart; i < startLine - 1; i++) {
    lines.push(` ${origLines[i]}`);
  }
  for (const l of oldLines) lines.push(`-${l}`);
  for (const l of newLines) lines.push(`+${l}`);
  for (let i = startLine - 1 + oldLines.length; i < regionEnd; i++) {
    lines.push(` ${origLines[i]}`);
  }

  return lines.join('\n');
}

/**
 * Attempt a fuzzy match when exact match fails.
 * Returns candidate line numbers and a diagnostic message.
 */
function fuzzySearch(content: string, needle: string): string | null {
  const normNeedle = normalizeWS(needle);
  const contentLines = content.split('\n');

  const needleLines = needle.split('\n');
  const needleLineCount = needleLines.length;

  const candidates: { line: number; snippet: string }[] = [];

  for (let i = 0; i <= contentLines.length - needleLineCount; i++) {
    const window = contentLines.slice(i, i + needleLineCount).join('\n');
    if (normalizeWS(window) === normNeedle) {
      candidates.push({
        line: i + 1,
        snippet: contentLines.slice(i, Math.min(i + 3, i + needleLineCount)).join('\n'),
      });
    }
  }

  if (candidates.length === 0) return null;

  const hints = candidates.map(c =>
    `  Line ${c.line}: ${c.snippet.split('\n')[0].trim().slice(0, 80)}`
  ).join('\n');

  return [
    `[HINT] Exact match failed but found ${candidates.length} whitespace-similar match(es):`,
    hints,
    '',
    'The indentation or spacing differs from what you provided.',
    'Use file/read to see the exact content, then retry with the precise string.',
  ].join('\n');
}

interface EditOp {
  old_string: string;
  new_string: string;
}

export function createFileEditHandler(onFileChanged?: (filePath: string) => void) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const filePath = String(kwargs.path || '');
    if (!filePath) return '[ERROR] Missing required argument: path';

    try {
      const uri = vscode.Uri.file(filePath);
      let content: string;
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
      if (doc) {
        content = doc.getText();
      } else {
        const existing = await vscode.workspace.fs.readFile(uri);
        content = new TextDecoder().decode(existing);
      }

      const replaceAll = kwargs.replace_all === true;

      // ── Build list of edit operations ──────────────────────────
      const ops: EditOp[] = [];

      if (kwargs.edits && Array.isArray(kwargs.edits)) {
        for (const e of kwargs.edits as any[]) {
          const os = String(e.old_string ?? '');
          const ns = String(e.new_string ?? '');
          if (!os) return '[ERROR] Each edit must have a non-empty old_string';
          ops.push({ old_string: os, new_string: ns });
        }
      } else if (kwargs.after_line !== undefined || kwargs.before_line !== undefined) {
        // Line-anchored insertion mode
        const insertText = String(kwargs.new_string ?? '');
        if (!insertText) return '[ERROR] new_string is required for line-anchored insertion';

        const lines = content.split('\n');
        let targetLine: number;

        if (kwargs.after_line !== undefined) {
          targetLine = Number(kwargs.after_line);
          if (targetLine < 0 || targetLine > lines.length) {
            return `[ERROR] after_line ${targetLine} is out of range (file has ${lines.length} lines)`;
          }
          const beforeInsert = lines.slice(0, targetLine).join('\n');
          const afterInsert = lines.slice(targetLine).join('\n');
          const updated = targetLine === 0
            ? insertText + '\n' + afterInsert
            : beforeInsert + '\n' + insertText + '\n' + afterInsert;

          await applyContent(uri, content, updated);

          const insertedCount = insertText.split('\n').length;
          return `[SUCCESS] Inserted ${insertedCount} line(s) after line ${targetLine} in ${filePath}`;
        } else {
          targetLine = Number(kwargs.before_line);
          if (targetLine < 1 || targetLine > lines.length + 1) {
            return `[ERROR] before_line ${targetLine} is out of range (file has ${lines.length} lines)`;
          }
          const beforeInsert = lines.slice(0, targetLine - 1).join('\n');
          const afterInsert = lines.slice(targetLine - 1).join('\n');
          const updated = targetLine === 1
            ? insertText + '\n' + afterInsert
            : beforeInsert + '\n' + insertText + '\n' + afterInsert;

          await applyContent(uri, content, updated);

          const insertedCount = insertText.split('\n').length;
          return `[SUCCESS] Inserted ${insertedCount} line(s) before line ${targetLine} in ${filePath}`;
        }
      } else if (kwargs.start_line !== undefined && kwargs.end_line !== undefined) {
        // Line-range delete mode
        const startLine = Number(kwargs.start_line);
        const endLine = Number(kwargs.end_line);
        const lines = content.split('\n');

        if (isNaN(startLine) || isNaN(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
          return `[ERROR] Invalid line range ${startLine}-${endLine} (file has ${lines.length} lines). Both start_line and end_line are 1-based and inclusive.`;
        }

        const deleted = lines.slice(startLine - 1, endLine);
        const updated = [...lines.slice(0, startLine - 1), ...lines.slice(endLine)].join('\n');

        await applyContent(uri, content, updated);
        onFileChanged?.(filePath);

        const preview = deleted.slice(0, 5).map(l => `-${l}`).join('\n');
        const more = deleted.length > 5 ? `\n  ... and ${deleted.length - 5} more lines` : '';
        return `[SUCCESS] Deleted lines ${startLine}-${endLine} (${deleted.length} line(s)) from ${filePath}\n${preview}${more}`;
      } else {
        // Standard single-edit mode
        const oldString = String(kwargs.old_string ?? '');
        const newString = String(kwargs.new_string ?? '');
        if (!oldString) return '[ERROR] Missing required argument: old_string (or use edits[] for multi-edit, or start_line+end_line for line-range delete)';
        ops.push({ old_string: oldString, new_string: newString });
      }

      // ── Validate all ops before applying any ──────────────────
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (!content.includes(op.old_string)) {
          // Try Unicode-normalized matching before giving up
          const resolved = unicodeMatch(content, op.old_string);
          if (resolved) {
            op.old_string = resolved;
          } else {
            const fuzzyHint = fuzzySearch(content, op.old_string);
            const prefix = ops.length > 1 ? `Edit ${i + 1}/${ops.length}: ` : '';
            if (fuzzyHint) {
              return `[ERROR] ${prefix}old_string not found in ${filePath}.\n${fuzzyHint}`;
            }
            let diagnostic = '';
            const closest = findClosestRegion(content, op.old_string);
            if (closest) {
              const actualFirst = closest.actual.split('\n')[0];
              const needleFirst = op.old_string.split('\n')[0];
              let divergeIdx = 0;
              const aCh = [...actualFirst];
              const nCh = [...needleFirst];
              while (divergeIdx < aCh.length && divergeIdx < nCh.length && aCh[divergeIdx] === nCh[divergeIdx]) divergeIdx++;
              diagnostic = [
                '',
                `[DIAGNOSTIC] Closest content near line ${closest.line}:`,
                `  File has:  ${hexAnnotate(actualFirst)}`,
                `  You sent:  ${hexAnnotate(needleFirst)}`,
                `  First difference at character ${divergeIdx}`,
              ].join('\n');
            }
            return `[ERROR] ${prefix}old_string not found in ${filePath}. Make sure the string matches exactly (including whitespace and indentation).${diagnostic}`;
          }
        }

        if (!replaceAll) {
          const count = content.split(op.old_string).length - 1;
          if (count > 1) {
            const line = findLineOf(content, op.old_string);
            return `[ERROR] ${ops.length > 1 ? `Edit ${i + 1}: ` : ''}old_string appears ${count} times in ${filePath} (first at line ${line}). Use replace_all=true or provide more surrounding context to make it unique.`;
          }
        }
      }

      // ── Apply all edits sequentially to the content ───────────
      let updated = content;
      const diffs: string[] = [];

      for (const op of ops) {
        const startLine = findLineOf(updated, op.old_string);
        if (replaceAll) {
          updated = updated.split(op.old_string).join(op.new_string);
        } else {
          updated = updated.replace(op.old_string, op.new_string);
        }
        diffs.push(buildContextDiff(filePath, content, updated, op.old_string, op.new_string, startLine));
      }

      // ── Write via WorkspaceEdit (undo-aware) or filesystem ────
      await applyContent(uri, content, updated);
      onFileChanged?.(filePath);

      const editCount = ops.length === 1 ? '' : ` (${ops.length} edits)`;
      return `[SUCCESS] Edited ${filePath}${editCount}\n${diffs.join('\n\n')}`;
    } catch (err) {
      return `[ERROR] Failed to edit file '${filePath}': ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

/**
 * Apply updated content to a file, using WorkspaceEdit for undo support
 * when the file is open in an editor, or direct filesystem write otherwise.
 */
async function applyContent(uri: vscode.Uri, originalContent: string, updatedContent: string): Promise<void> {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
  if (doc) {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length),
    );
    edit.replace(uri, fullRange, updatedContent);
    await vscode.workspace.applyEdit(edit);
  } else {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedContent));
  }
}
