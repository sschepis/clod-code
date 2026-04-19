import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import { logger } from '../shared/logger';

/** Loaded lazily so a missing native binding doesn't kill the extension. */
let nutPromise: Promise<any> | null = null;

function loadNut(): Promise<any> {
  if (!nutPromise) {
    nutPromise = (async () => {
      try {
        return await import('@nut-tree-fork/nut-js');
      } catch (err) {
        logger.error('[ui] failed to load @nut-tree-fork/nut-js', err);
        throw new Error(
          `Failed to load @nut-tree-fork/nut-js: ${err instanceof Error ? err.message : String(err)}. ` +
          `On macOS you must grant VS Code permissions for Accessibility and Screen Recording under ` +
          `System Settings → Privacy & Security.`
        );
      }
    })();
  }
  return nutPromise;
}

function gateCheck(): string | null {
  if (!getSettings().uiControlEnabled) {
    return `[ERROR] UI control is disabled. Enable "Oboto VS: UI Control Enabled" in Oboto VS Settings to allow the AI to capture the screen and drive mouse/keyboard.`;
  }
  return null;
}

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

function screenshotDir(): string {
  const root = workspaceRoot();
  const base = root ?? process.cwd();
  return path.join(base, '.obotovs', 'screenshots');
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ── Screenshot ──────────────────────────────────────────────────────

export function createUiScreenshotHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const gate = gateCheck();
    if (gate) return gate;

    const name = typeof kwargs.name === 'string' && kwargs.name.trim()
      ? kwargs.name.trim().replace(/[^A-Za-z0-9_-]/g, '_')
      : `screenshot-${timestamp()}`;

    const hasRegion =
      typeof kwargs.x === 'number' && typeof kwargs.y === 'number' &&
      typeof kwargs.width === 'number' && typeof kwargs.height === 'number';

    try {
      const nut = await loadNut();
      const dir = screenshotDir();
      fs.mkdirSync(dir, { recursive: true });

      const FileType = nut.FileType;
      let savedPath: string;

      if (hasRegion) {
        const region = new nut.Region(
          Number(kwargs.x), Number(kwargs.y),
          Number(kwargs.width), Number(kwargs.height),
        );
        savedPath = await nut.screen.captureRegion(name, region, FileType.PNG, dir);
      } else {
        savedPath = await nut.screen.capture(name, FileType.PNG, dir);
      }

      // Some versions return just the filename — normalize to absolute.
      if (!path.isAbsolute(savedPath)) savedPath = path.join(dir, savedPath);
      if (!savedPath.endsWith('.png')) savedPath += '.png';

      const size = (() => {
        try { return fs.statSync(savedPath).size; } catch { return 0; }
      })();

      return `[SUCCESS] Screenshot saved to ${savedPath} (${size} bytes).\n\n![${name}](${vscode.Uri.file(savedPath).toString()})`;
    } catch (err) {
      return `[ERROR] Screenshot failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

// ── Cursor position ─────────────────────────────────────────────────

export function createUiCursorHandler() {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const gate = gateCheck();
    if (gate) return gate;
    try {
      const nut = await loadNut();
      const p = await nut.mouse.getPosition();
      return `Cursor at (${p.x}, ${p.y}).`;
    } catch (err) {
      return `[ERROR] Failed to read cursor: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

// ── Mouse move / click / drag ───────────────────────────────────────

function parsePoint(kwargs: Record<string, unknown>): { x: number; y: number } | null {
  if (typeof kwargs.x === 'number' && typeof kwargs.y === 'number') {
    return { x: kwargs.x, y: kwargs.y };
  }
  return null;
}

export function createUiMoveHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const gate = gateCheck();
    if (gate) return gate;
    const pt = parsePoint(kwargs);
    if (!pt) return '[ERROR] Missing required arguments: x, y';
    try {
      const nut = await loadNut();
      await nut.mouse.move(nut.straightTo(new nut.Point(pt.x, pt.y)));
      return `[SUCCESS] Moved cursor to (${pt.x}, ${pt.y}).`;
    } catch (err) {
      return `[ERROR] Move failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createUiClickHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const gate = gateCheck();
    if (gate) return gate;
    const btnRaw = String(kwargs.button ?? 'left').toLowerCase();
    const doubleClick = kwargs.double === true;
    try {
      const nut = await loadNut();

      // Optional: move first if x/y provided
      const pt = parsePoint(kwargs);
      if (pt) {
        await nut.mouse.move(nut.straightTo(new nut.Point(pt.x, pt.y)));
      }

      const btn = btnRaw === 'right' ? nut.Button.RIGHT
                : btnRaw === 'middle' ? nut.Button.MIDDLE
                : nut.Button.LEFT;

      if (doubleClick) {
        await nut.mouse.doubleClick(btn);
      } else if (btn === nut.Button.LEFT) {
        await nut.mouse.leftClick();
      } else if (btn === nut.Button.RIGHT) {
        await nut.mouse.rightClick();
      } else {
        await nut.mouse.click(btn);
      }

      const where = pt ? `at (${pt.x}, ${pt.y})` : 'at current position';
      return `[SUCCESS] ${doubleClick ? 'Double-clicked' : 'Clicked'} ${btnRaw} ${where}.`;
    } catch (err) {
      return `[ERROR] Click failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createUiDragHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const gate = gateCheck();
    if (gate) return gate;
    const fromX = typeof kwargs.from_x === 'number' ? kwargs.from_x : null;
    const fromY = typeof kwargs.from_y === 'number' ? kwargs.from_y : null;
    const toX = typeof kwargs.to_x === 'number' ? kwargs.to_x : null;
    const toY = typeof kwargs.to_y === 'number' ? kwargs.to_y : null;
    if (fromX === null || fromY === null || toX === null || toY === null) {
      return '[ERROR] Missing required arguments: from_x, from_y, to_x, to_y';
    }
    try {
      const nut = await loadNut();
      await nut.mouse.move(nut.straightTo(new nut.Point(fromX, fromY)));
      await nut.mouse.pressButton(nut.Button.LEFT);
      try {
        await nut.mouse.move(nut.straightTo(new nut.Point(toX, toY)));
      } finally {
        await nut.mouse.releaseButton(nut.Button.LEFT);
      }
      return `[SUCCESS] Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY}).`;
    } catch (err) {
      return `[ERROR] Drag failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

// ── Keyboard type / press ───────────────────────────────────────────

export function createUiTypeHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const gate = gateCheck();
    if (gate) return gate;
    const text = typeof kwargs.text === 'string' ? kwargs.text : '';
    if (!text) return '[ERROR] Missing required argument: text';
    try {
      const nut = await loadNut();
      await nut.keyboard.type(text);
      return `[SUCCESS] Typed ${text.length} characters.`;
    } catch (err) {
      return `[ERROR] Type failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

function resolveKey(nut: any, name: string): any {
  const Key = nut.Key;
  // Normalize common synonyms
  const normalized = name.trim();
  const lower = normalized.toLowerCase();
  const synonyms: Record<string, string> = {
    cmd: 'LeftCmd', command: 'LeftCmd', meta: 'LeftCmd',
    ctrl: 'LeftControl', control: 'LeftControl',
    alt: 'LeftAlt', option: 'LeftAlt',
    shift: 'LeftShift',
    enter: 'Return', return: 'Return',
    esc: 'Escape',
    del: 'Delete',
    space: 'Space',
    tab: 'Tab',
    backspace: 'Backspace',
    up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  };
  const canonical = synonyms[lower] ?? normalized;
  if (canonical in Key) return Key[canonical];

  // Single-letter case-insensitive fallback ("a" → Key.A)
  if (/^[a-z]$/i.test(normalized)) {
    const upper = normalized.toUpperCase();
    if (upper in Key) return Key[upper];
  }

  throw new Error(`Unknown key "${name}"`);
}

export function createUiPressHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const gate = gateCheck();
    if (gate) return gate;
    const keysRaw = kwargs.keys;
    let keys: string[] = [];
    if (Array.isArray(keysRaw)) keys = keysRaw.map(String);
    else if (typeof keysRaw === 'string') {
      keys = keysRaw.split('+').map((s) => s.trim()).filter(Boolean);
    }
    if (keys.length === 0) return '[ERROR] Missing required argument: keys (array or "Cmd+S" string)';
    try {
      const nut = await loadNut();
      const resolved = keys.map((k) => resolveKey(nut, k));
      await nut.keyboard.pressKey(...resolved);
      await nut.keyboard.releaseKey(...resolved);
      return `[SUCCESS] Pressed ${keys.join('+')}.`;
    } catch (err) {
      return `[ERROR] Press failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
