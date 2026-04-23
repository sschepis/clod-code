import * as cheerio from 'cheerio';

let lastSearchTime = 0;
const MIN_SEARCH_INTERVAL_MS = 2000;

export function createWebSearchHandler() {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const query = String(kwargs.query || '').trim();
    if (!query) return '[ERROR] Missing required argument: query. Provide a search query (e.g. "TypeScript zod validation", "ECONNRESET node.js fix").';

    const maxResults = typeof kwargs.max_results === 'number' ? kwargs.max_results : 8;

    const now = Date.now();
    const elapsed = now - lastSearchTime;
    if (elapsed < MIN_SEARCH_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_SEARCH_INTERVAL_MS - elapsed));
    }
    lastSearchTime = Date.now();

    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    try {
      if (braveKey) {
        return await searchBrave(query, maxResults, braveKey);
      }
      return await searchDuckDuckGo(query, maxResults);
    } catch (err) {
      return `[ERROR] Web search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

async function searchBrave(query: string, maxResults: number, apiKey: string): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    if (res.status === 429) return '[ERROR] Brave Search rate limited. Wait a moment and try again.';
    return `[ERROR] Brave Search returned HTTP ${res.status}: ${res.statusText}`;
  }

  const data = await res.json() as any;
  const results = data?.web?.results;
  if (!results || results.length === 0) {
    return `[INFO] No search results found for "${query}". Try broader or different search terms.`;
  }

  const lines: string[] = [`## Web Search Results for "${query}"\n`];
  for (let i = 0; i < Math.min(results.length, maxResults); i++) {
    const r = results[i];
    lines.push(`${i + 1}. **${r.title || 'Untitled'}**`);
    lines.push(`   URL: ${r.url}`);
    if (r.description) lines.push(`   ${r.description}`);
    lines.push('');
  }
  lines.push(`[${Math.min(results.length, maxResults)} results from Brave Search]`);
  return lines.join('\n');
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<string> {
  const res = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; ObotoVS/0.1)',
    },
    body: `q=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return `[ERROR] DuckDuckGo returned HTTP ${res.status}: ${res.statusText}`;
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const results: { title: string; url: string; snippet: string }[] = [];

  // DuckDuckGo lite uses a table-based layout with result links and snippets
  $('a.result-link').each((_i, el) => {
    if (results.length >= maxResults) return false;
    const $a = $(el);
    const title = $a.text().trim();
    const url = $a.attr('href') || '';
    if (!title || !url) return;

    // Snippet is in the next table row's result-snippet cell
    const $row = $a.closest('tr');
    const snippet = $row.next('tr').find('.result-snippet').text().trim();

    results.push({ title, url, snippet });
  });

  // Fallback: try alternate selectors if the above found nothing
  if (results.length === 0) {
    $('table.t a.result__a, a[data-testid="result-title-a"]').each((_i, el) => {
      if (results.length >= maxResults) return false;
      const $a = $(el);
      const title = $a.text().trim();
      const href = $a.attr('href') || '';
      if (!title || !href) return;

      const url = href.startsWith('//duckduckgo.com/l/') ? decodeURIComponent(href.replace(/.*uddg=/, '').split('&')[0]) : href;
      const snippet = $a.closest('.result, .web-result').find('.result__snippet, .result-snippet').text().trim();
      results.push({ title, url, snippet });
    });
  }

  if (results.length === 0) {
    return `[INFO] No search results found for "${query}". Try broader or different search terms.`;
  }

  const lines: string[] = [`## Web Search Results for "${query}"\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. **${r.title}**`);
    lines.push(`   URL: ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push('');
  }
  lines.push(`[${results.length} results from DuckDuckGo]`);
  return lines.join('\n');
}
