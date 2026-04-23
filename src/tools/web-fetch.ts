import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const MAX_RAW_BYTES = 5 * 1024 * 1024; // 5MB max download
const DEFAULT_MAX_LENGTH = 50_000;

export function createWebFetchHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const url = String(kwargs.url || '').trim();
    if (!url) return '[ERROR] Missing required argument: url. Provide a URL to fetch (e.g. "https://docs.example.com/api").';
    if (!/^https?:\/\//i.test(url)) return `[ERROR] Invalid URL: "${url}". Must start with http:// or https://.`;

    const maxLength = typeof kwargs.max_length === 'number' ? kwargs.max_length : DEFAULT_MAX_LENGTH;
    const selector = typeof kwargs.selector === 'string' ? kwargs.selector : undefined;
    const customHeaders = typeof kwargs.headers === 'object' && kwargs.headers ? kwargs.headers as Record<string, string> : {};

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ObotoVS/0.1; +https://github.com)',
          'Accept': 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
          ...customHeaders,
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });

      if (!res.ok) {
        return `[ERROR] HTTP ${res.status} ${res.statusText} fetching ${url}.${res.status === 403 ? ' The site may require authentication or block bots.' : ''}`;
      }

      const contentType = res.headers.get('content-type') || '';
      const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_RAW_BYTES) {
        return `[ERROR] Response too large (${(contentLength / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_RAW_BYTES / 1024 / 1024}MB.`;
      }

      if (/\b(image|audio|video|octet-stream|zip|gzip|tar|pdf)\b/.test(contentType)) {
        return `[ERROR] Cannot extract text from binary content (${contentType}). Use a text/HTML URL instead.`;
      }

      const raw = await res.text();

      if (/application\/json|\+json/.test(contentType)) {
        return formatJson(url, contentType, raw, maxLength);
      }

      if (/text\/html|application\/xhtml/.test(contentType)) {
        return extractHtml(url, contentType, raw, maxLength, selector);
      }

      // Plain text, CSV, XML, etc.
      const truncated = raw.length > maxLength ? raw.slice(0, maxLength) + `\n\n... [truncated at ${maxLength} chars]` : raw;
      return `## Fetched: ${url}\nContent-Type: ${contentType}\n\n${truncated}\n\n[${raw.length} chars]`;
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        return `[ERROR] Request timed out after 15s fetching ${url}. The site may be down or blocking automated requests.`;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
        const host = new URL(url).hostname;
        return `[ERROR] Could not resolve hostname: ${host}. Check the URL spelling.`;
      }
      return `[ERROR] Failed to fetch URL: ${msg}`;
    }
  };
}

function formatJson(url: string, contentType: string, raw: string, maxLength: number): string {
  try {
    const parsed = JSON.parse(raw);
    const formatted = JSON.stringify(parsed, null, 2);
    const truncated = formatted.length > maxLength ? formatted.slice(0, maxLength) + '\n\n... [truncated]' : formatted;
    return `## Fetched: ${url}\nContent-Type: ${contentType}\n\n\`\`\`json\n${truncated}\n\`\`\`\n\n[${formatted.length} chars of JSON]`;
  } catch {
    const truncated = raw.length > maxLength ? raw.slice(0, maxLength) + '\n\n... [truncated]' : raw;
    return `## Fetched: ${url}\nContent-Type: ${contentType}\n\n${truncated}\n\n[${raw.length} chars]`;
  }
}

function extractHtml(url: string, contentType: string, html: string, maxLength: number, selector?: string): string {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || url;

  if (selector) {
    const selected = $(selector);
    if (selected.length === 0) {
      return `[ERROR] CSS selector "${selector}" matched no elements on ${url}. Try a broader selector or omit it.`;
    }
    const text = cleanText(selected.text());
    const truncated = text.length > maxLength ? text.slice(0, maxLength) + `\n\n... [truncated at ${maxLength} chars]` : text;
    return `## Fetched: ${title}\nSource: ${url}\nContent-Type: ${contentType}\nSelector: ${selector}\n\n${truncated}\n\n[Extracted ${text.length} chars from selector]`;
  }

  // Remove boilerplate elements
  $('script, style, noscript, svg, path, iframe, object, embed').remove();
  $('nav, footer, aside, [role="navigation"], [role="complementary"], [role="banner"], [aria-hidden="true"]').remove();
  $('.sidebar, .menu, .nav, .ad, .advertisement, .cookie-banner, .cookie-consent, .popup, .modal').remove();

  // Try Readability for article extraction
  let extracted = tryReadability(html, url);
  if (!extracted || extracted.length < 200) {
    extracted = cleanText($('body').text());
  }

  if (extracted.length < 100) {
    return `[INFO] Page at ${url} contains very little text (${extracted.length} chars). This may be a JavaScript-rendered SPA that requires a browser to load. Try web/browse instead, or search for a cached/text version.`;
  }

  const truncated = extracted.length > maxLength ? extracted.slice(0, maxLength) + `\n\n... [truncated at ${maxLength} chars]` : extracted;
  return `## Fetched: ${title}\nSource: ${url}\nContent-Type: ${contentType}\n\n${truncated}\n\n[Extracted ${extracted.length} chars from ${(html.length / 1024).toFixed(0)}KB page]`;
}

function tryReadability(html: string, _url: string): string | null {
  try {
    const parsed = parseHTML(html);
    const doc = (parsed as any).document ?? parsed;
    const reader = new Readability(doc as any, { charThreshold: 100 });
    const article = reader.parse();
    if (article && article.textContent) {
      return cleanText(article.textContent);
    }
  } catch {
    // Readability can fail on malformed HTML — that's fine, we fall back
  }
  return null;
}

function cleanText(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();
}
