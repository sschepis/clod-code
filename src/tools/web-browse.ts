import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { logger } from '../shared/logger';

type PuppeteerCore = typeof import('puppeteer-core');
type Browser = import('puppeteer-core').Browser;
type Page = import('puppeteer-core').Page;

let puppeteerModule: PuppeteerCore | null = null;

async function loadPuppeteer(): Promise<PuppeteerCore> {
  if (!puppeteerModule) {
    try {
      puppeteerModule = await import('puppeteer-core') as any;
    } catch (err) {
      throw new Error(`Failed to load puppeteer-core: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return puppeteerModule!;
}

function findChrome(): string {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  }

  const platform = process.platform;

  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }

  if (platform === 'linux') {
    const names = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
    for (const name of names) {
      try {
        const p = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
        if (p) return p;
      } catch { /* not found */ }
    }
  }

  if (platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }

  throw new Error(
    'No Chrome/Chromium installation found. Install Google Chrome or set the CHROME_PATH environment variable.'
  );
}

function screenshotDir(): string {
  const folders = vscode.workspace.workspaceFolders;
  const base = folders?.[0]?.uri.fsPath ?? process.cwd();
  return path.join(base, '.obotovs', 'screenshots');
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private disposed = false;

  async ensureBrowser(viewportWidth = 1280, viewportHeight = 800): Promise<Page> {
    if (this.disposed) throw new Error('Browser session has been disposed.');

    if (this.browser && this.page) {
      try {
        await this.page.evaluate(() => true);
        return this.page;
      } catch {
        // Browser/page died — relaunch
        this.browser = null;
        this.page = null;
      }
    }

    const puppeteer = await loadPuppeteer();
    const chromePath = findChrome();
    logger.info(`[web-browse] Launching headless Chrome: ${chromePath}`);

    this.browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${viewportWidth},${viewportHeight}`,
      ],
      defaultViewport: { width: viewportWidth, height: viewportHeight },
    });

    const pages = await this.browser.pages();
    this.page = pages[0] || await this.browser.newPage();
    await this.page.setViewport({ width: viewportWidth, height: viewportHeight });

    this.browser.on('disconnected', () => {
      this.browser = null;
      this.page = null;
    });

    return this.page;
  }

  async navigate(url: string, waitMs = 2000, viewportWidth = 1280, viewportHeight = 800): Promise<{ screenshotPath: string; title: string; textPreview: string }> {
    const page = await this.ensureBrowser(viewportWidth, viewportHeight);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });

    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
    }

    const title = await page.title();
    const textPreview = await page.evaluate(`
      (() => {
        const body = document.body;
        if (!body) return '';
        const clone = body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript, svg, nav, footer, aside').forEach(el => el.remove());
        return (clone.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 2000);
      })()
    `) as string;

    const screenshotPath = await this.captureScreenshot();
    return { screenshotPath, title, textPreview };
  }

  async captureScreenshot(opts?: { name?: string; fullPage?: boolean; selector?: string }): Promise<string> {
    const page = await this.getPage();
    const dir = screenshotDir();
    fs.mkdirSync(dir, { recursive: true });

    const name = opts?.name?.replace(/[^A-Za-z0-9_-]/g, '_') || `browse-${timestamp()}`;
    const filePath = path.join(dir, `${name}.png`);

    if (opts?.selector) {
      const el = await page.$(opts.selector);
      if (!el) throw new Error(`Element not found: "${opts.selector}"`);
      await el.screenshot({ path: filePath });
    } else {
      await page.screenshot({ path: filePath, fullPage: opts?.fullPage ?? false });
    }

    return filePath;
  }

  async click(selector?: string, x?: number, y?: number): Promise<void> {
    const page = await this.getPage();

    if (selector) {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
    } else if (x !== undefined && y !== undefined) {
      await page.mouse.click(x, y);
    } else {
      throw new Error('Provide either a CSS selector or x/y coordinates.');
    }

    // Wait briefly for any navigation or re-render
    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
  }

  async type(selector: string, text: string, submit = false): Promise<void> {
    const page = await this.getPage();
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.click(selector, { clickCount: 3 }); // select all
    await page.keyboard.press('Backspace');
    await page.type(selector, text, { delay: 30 });
    if (submit) {
      await page.keyboard.press('Enter');
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    }
  }

  async evaluate(expression: string): Promise<string> {
    const page = await this.getPage();
    const safeExpr = expression.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const result = await page.evaluate(`
      (() => {
        try {
          const r = eval(\`${safeExpr}\`);
          if (r === undefined) return 'undefined';
          if (r === null) return 'null';
          if (typeof r === 'object') return JSON.stringify(r, null, 2);
          return String(r);
        } catch (e) {
          return 'Error: ' + (e.message || e);
        }
      })()
    `) as string;
    return result;
  }

  async close(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close(); } catch { /* already closed */ }
      this.browser = null;
      this.page = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.close().catch(() => {});
  }

  private async getPage(): Promise<Page> {
    if (!this.page || !this.browser) {
      throw new Error('No browser session active. Use web/browse to open a page first.');
    }
    try {
      await this.page.evaluate(() => true);
    } catch {
      throw new Error('Browser session crashed. Use web/browse to start a new session.');
    }
    return this.page;
  }
}

export interface WebBrowseDeps {
  getSession: () => BrowserSession;
}

function screenshotMarkdown(filePath: string, label: string): string {
  const uri = vscode.Uri.file(filePath).toString();
  return `![${label}](${uri})`;
}

// ── Tool handler factories ─────────────────────────────────────

export function createWebBrowseHandler(deps: WebBrowseDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const url = String(kwargs.url || '').trim();
    if (!url) return '[ERROR] Missing required argument: url. Provide a URL to browse (e.g. "https://docs.example.com").';
    if (!/^https?:\/\//i.test(url)) return `[ERROR] Invalid URL: "${url}". Must start with http:// or https://.`;

    const wait = typeof kwargs.wait === 'number' ? kwargs.wait : 2000;
    const vw = typeof kwargs.viewport_width === 'number' ? kwargs.viewport_width : 1280;
    const vh = typeof kwargs.viewport_height === 'number' ? kwargs.viewport_height : 800;

    try {
      const session = deps.getSession();
      const { screenshotPath, title, textPreview } = await session.navigate(url, wait, vw, vh);

      const lines: string[] = [];
      lines.push(`[SUCCESS] Browsed to: ${url}`);
      lines.push(`Title: ${title}`);
      lines.push('');
      lines.push(screenshotMarkdown(screenshotPath, `${title || 'page'} screenshot`));
      lines.push('');
      if (textPreview) {
        lines.push('**Page text preview:**');
        lines.push(textPreview);
      }
      return lines.join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timeout') || msg.includes('Timeout')) {
        return `[ERROR] Page load timed out after 30s for ${url}. The site may be slow or blocking headless browsers.`;
      }
      return `[ERROR] Browse failed: ${msg}`;
    }
  };
}

export function createWebClickHandler(deps: WebBrowseDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const selector = typeof kwargs.selector === 'string' ? kwargs.selector : undefined;
    const x = typeof kwargs.x === 'number' ? kwargs.x : undefined;
    const y = typeof kwargs.y === 'number' ? kwargs.y : undefined;

    if (!selector && (x === undefined || y === undefined)) {
      return '[ERROR] Provide either selector (CSS selector) or x/y coordinates to click.';
    }

    try {
      const session = deps.getSession();
      await session.click(selector, x, y);
      const screenshotPath = await session.captureScreenshot({ name: `click-${timestamp()}` });

      const target = selector ? `"${selector}"` : `(${x}, ${y})`;
      return `[SUCCESS] Clicked ${target}.\n\n${screenshotMarkdown(screenshotPath, 'after click')}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found') || msg.includes('waitForSelector')) {
        return `[ERROR] Element not found: "${selector}". Use web/screenshot to see the current page and find the right selector.`;
      }
      return `[ERROR] Click failed: ${msg}`;
    }
  };
}

export function createWebTypeHandler(deps: WebBrowseDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const selector = typeof kwargs.selector === 'string' ? kwargs.selector : '';
    const text = typeof kwargs.text === 'string' ? kwargs.text : '';
    const submit = kwargs.submit === true;

    if (!selector) return '[ERROR] Missing required argument: selector (CSS selector for the input field).';
    if (!text) return '[ERROR] Missing required argument: text (text to type into the field).';

    try {
      const session = deps.getSession();
      await session.type(selector, text, submit);
      const screenshotPath = await session.captureScreenshot({ name: `type-${timestamp()}` });

      return `[SUCCESS] Typed "${text.length > 50 ? text.slice(0, 50) + '…' : text}" into ${selector}${submit ? ' and pressed Enter' : ''}.\n\n${screenshotMarkdown(screenshotPath, 'after typing')}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[ERROR] Type failed: ${msg}`;
    }
  };
}

export function createWebScreenshotHandler(deps: WebBrowseDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = typeof kwargs.name === 'string' ? kwargs.name : undefined;
    const fullPage = kwargs.full_page === true;
    const selector = typeof kwargs.selector === 'string' ? kwargs.selector : undefined;

    try {
      const session = deps.getSession();
      const screenshotPath = await session.captureScreenshot({ name, fullPage, selector });
      const size = fs.statSync(screenshotPath).size;

      return `[SUCCESS] Screenshot captured (${(size / 1024).toFixed(0)}KB).\n\n${screenshotMarkdown(screenshotPath, name || 'browser screenshot')}`;
    } catch (err) {
      return `[ERROR] Screenshot failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createWebEvalHandler(deps: WebBrowseDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const expression = typeof kwargs.expression === 'string' ? kwargs.expression : '';
    if (!expression) return '[ERROR] Missing required argument: expression (JavaScript to evaluate in the page).';

    try {
      const session = deps.getSession();
      const result = await session.evaluate(expression);
      const truncated = result.length > 10_000 ? result.slice(0, 10_000) + '\n\n... [truncated]' : result;
      return `[SUCCESS] Evaluated expression.\n\nResult:\n${truncated}`;
    } catch (err) {
      return `[ERROR] Eval failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createWebCloseHandler(deps: WebBrowseDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    try {
      const session = deps.getSession();
      await session.close();
      return '[SUCCESS] Browser session closed.';
    } catch (err) {
      return `[ERROR] Close failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
